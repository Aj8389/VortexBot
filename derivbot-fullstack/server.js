// ============================================================
// DerivBot Pro — 24/7 Auto-Run Backend for Render.com
// Flow: User sets config + token on UI → clicks START BOT
//       → Bot runs FOREVER, never stops, auto-reconnects
// ============================================================

const express  = require("express");
const http     = require("http");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;
const path     = require("path");
const https    = require("https");

const app = express();
app.use(express.static(path.join(__dirname, "dist/derivbot-pro/browser")));
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const DERIV_WS = "wss://ws.binaryws.com/websockets/v3?app_id=1089";
const PORT     = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────
let state = {
  // Connections
  derivSocket:    null,
  browserClients: new Set(),
  derivReconnectTimer: null,
  derivReconnectAttempts: 0,

  // Auth
  token:      null,
  authorized: false,
  loginid:    null,

  // Account
  balance:  0,
  currency: "USD",

  // Bot — persists even when browser disconnects
  botRunning:  false,
  botSettings: null,   // saved settings so bot restarts after reconnect

  // Market config
  symbol:       "R_100",
  strategy:     "RSI_EMA",

  // Risk
  stake:                10,
  baseStake:            10,
  stopLossPct:          15,
  takeProfitPct:        30,
  maxTradesPerDay:      10,
  dailyLossLimit:       100,
  martingaleEnabled:    false,
  martingaleMultiplier: 2,
  martingaleMaxSteps:   3,
  martStep:             0,

  // Contract
  contractType: "AUTO",
  duration:     1,
  durationUnit: "m",

  // Pause logic
  pauseOn3Losses:    true,
  consecutiveLosses: 0,
  paused:            false,
  pauseTimer:        null,

  // Daily stats — reset at midnight
  todayWins:       0,
  todayLosses:     0,
  todayPnl:        0,
  todayTradeCount: 0,
  bestStreak:      0,
  currentStreak:   0,
  lastResetDate:   new Date().toDateString(),

  // Trade tracking
  trades:          [],
  activeTrade:     null,
  activeContractId: null,

  // Price data
  tickBuffer:   [],
  priceHistory: [],
  currentPrice: 0,
  lastPrice:    0,

  reqId:          1,
  lastSignalTime: 0,
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function nextId() { return ++state.reqId; }

function sendDeriv(data) {
  if (state.derivSocket && state.derivSocket.readyState === WebSocket.OPEN) {
    state.derivSocket.send(JSON.stringify(data));
  }
}

function broadcast(data) {
  const raw = JSON.stringify(data);
  state.browserClients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(raw); } catch (_) {}
    }
  });
}

function log(msg, level = "info") {
  const ts = new Date().toTimeString().slice(0, 8);
  console.log(`[${ts}][${level.toUpperCase()}] ${msg}`);
  broadcast({ type: "LOG", msg, level });
}

function getStats() {
  const total = state.todayWins + state.todayLosses;
  return {
    wins:       state.todayWins,
    losses:     state.todayLosses,
    total:      state.todayTradeCount,
    pnl:        parseFloat(state.todayPnl.toFixed(2)),
    winRate:    total > 0 ? Math.round((state.todayWins / total) * 100) : 0,
    bestStreak: state.bestStreak,
    remaining:  Math.max(0, state.maxTradesPerDay - state.todayTradeCount),
  };
}

// Reset daily stats at midnight automatically
function checkDailyReset() {
  const today = new Date().toDateString();
  if (state.lastResetDate !== today) {
    state.todayWins       = 0;
    state.todayLosses     = 0;
    state.todayPnl        = 0;
    state.todayTradeCount = 0;
    state.lastResetDate   = today;
    log("📅 Daily stats reset for new day", "info");
    broadcast({ type: "STATS_RESET" });
  }
}

// ─────────────────────────────────────────────
// TECHNICAL INDICATORS
// ─────────────────────────────────────────────
function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return 0;
  return parseFloat((ema12 - ema26).toFixed(6));
}

function calcBollinger(prices, period = 20) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / period);
  return { upper: mean + 2 * std, middle: mean, lower: mean - 2 * std };
}

function analyzeSignal() {
  const prices = state.priceHistory;
  if (prices.length < 30) {
    return { signal: "WAIT", reason: "Collecting data...", rsi: 50, ema9: 0, ema21: 0, strength: 0, macd: 0 };
  }

  const rsi   = calcRSI(prices, 14);
  const ema9  = calcEMA(prices, 9)  || prices[prices.length - 1];
  const ema21 = calcEMA(prices, 21) || prices[prices.length - 1];
  const macd  = calcMACD(prices);
  const boll  = calcBollinger(prices, 20);
  const price = state.currentPrice;

  let signal = "WAIT", reason = "Scanning...", strength = 0;

  if (state.strategy === "RSI_EMA") {
    if      (rsi < 30 && ema9 > ema21) { signal = "BUY";  reason = `RSI oversold (${rsi}) + EMA bullish`;  strength = Math.min(100, 70 + (30 - rsi)); }
    else if (rsi > 70 && ema9 < ema21) { signal = "SELL"; reason = `RSI overbought (${rsi}) + EMA bearish`; strength = Math.min(100, 70 + (rsi - 70)); }
    else if (rsi < 35 && ema9 > ema21) { signal = "BUY";  reason = `RSI low (${rsi}) + bullish EMA`;        strength = Math.min(100, 55 + (35 - rsi)); }
    else if (rsi > 65 && ema9 < ema21) { signal = "SELL"; reason = `RSI high (${rsi}) + bearish EMA`;       strength = Math.min(100, 55 + (rsi - 65)); }
    else { reason = `RSI: ${rsi} | EMA: ${ema9 > ema21 ? "Bull" : "Bear"}`; strength = 20; }

  } else if (state.strategy === "BOLLINGER" && boll) {
    if      (price < boll.lower) { signal = "BUY";  reason = `Below lower band ${boll.lower.toFixed(2)}`; strength = 70; }
    else if (price > boll.upper) { signal = "SELL"; reason = `Above upper band ${boll.upper.toFixed(2)}`; strength = 70; }
    else { reason = `In bands [${boll.lower.toFixed(2)}–${boll.upper.toFixed(2)}]`; strength = 25; }

  } else if (state.strategy === "MACD") {
    const prevMacd = calcMACD(prices.slice(0, -1));
    if      (macd > 0 && prevMacd <= 0) { signal = "BUY";  reason = `MACD bullish cross (${macd.toFixed(4)})`; strength = 65; }
    else if (macd < 0 && prevMacd >= 0) { signal = "SELL"; reason = `MACD bearish cross (${macd.toFixed(4)})`; strength = 65; }
    else { reason = `MACD: ${macd.toFixed(4)}`; strength = 20; }

  } else if (state.strategy === "SCALPER") {
    if (prices.length >= 5) {
      const recent = prices.slice(-5);
      const up = recent.filter((p, i) => i > 0 && p > recent[i - 1]).length;
      if      (up >= 4) { signal = "SELL"; reason = `4+ up ticks → reversal`; strength = 60; }
      else if (up <= 1) { signal = "BUY";  reason = `4+ down ticks → reversal`; strength = 60; }
      else { reason = `Mixed ticks (${up}/5 up)`; strength = 15; }
    }
  }

  return { signal, reason, rsi, ema9: parseFloat(ema9.toFixed(4)), ema21: parseFloat(ema21.toFixed(4)), strength, macd };
}

// ─────────────────────────────────────────────
// DERIV CONNECTION — with AUTO-RECONNECT
// ─────────────────────────────────────────────
function connectDeriv(token) {
  if (token) state.token = token;
  if (!state.token) return;

  // Clear any pending reconnect
  if (state.derivReconnectTimer) {
    clearTimeout(state.derivReconnectTimer);
    state.derivReconnectTimer = null;
  }

  if (state.derivSocket) {
    try { state.derivSocket.close(); } catch (_) {}
    state.derivSocket = null;
  }

  log("🔌 Connecting to Deriv...", "info");
  broadcast({ type: "CONN_STATUS", status: "connecting", label: "CONNECTING..." });

  const ws = new WebSocket(DERIV_WS);
  state.derivSocket = ws;

  ws.on("open", () => {
    state.derivReconnectAttempts = 0;
    log("✅ Deriv connected. Authorizing...", "ok");
    sendDeriv({ authorize: state.token, req_id: nextId() });
  });

  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch (_) { return; }
    handleDerivMessage(data);
  });

  ws.on("error", (err) => {
    log(`Deriv WS error: ${err.message}`, "err");
    broadcast({ type: "CONN_STATUS", status: "error", label: "WS ERROR" });
  });

  ws.on("close", (code) => {
    state.authorized = false;
    log(`⚠️ Deriv disconnected (code ${code}) — will auto-reconnect...`, "warn");
    broadcast({ type: "CONN_STATUS", status: "error", label: "RECONNECTING..." });

    // AUTO-RECONNECT — exponential backoff, max 30s
    state.derivReconnectAttempts++;
    const delay = Math.min(30000, 2000 * state.derivReconnectAttempts);
    log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${state.derivReconnectAttempts})...`, "warn");

    state.derivReconnectTimer = setTimeout(() => {
      connectDeriv(); // reconnect with saved token
    }, delay);
  });
}

// ─────────────────────────────────────────────
// HANDLE DERIV MESSAGES
// ─────────────────────────────────────────────
function handleDerivMessage(data) {
  if (data.error) {
    log(`Deriv error: ${data.error.message}`, "err");

    // If auth token is invalid — stop trying
    if (data.error.code === "InvalidToken" || data.error.code === "AuthorizationRequired") {
      log("❌ Invalid token — bot stopped. Please reconnect with valid token.", "err");
      state.botRunning = false;
      state.token = null;
      broadcast({ type: "INVALID_TOKEN" });
      if (state.derivReconnectTimer) clearTimeout(state.derivReconnectTimer);
    }
    return;
  }

  // AUTHORIZE
  if (data.msg_type === "authorize") {
    const auth = data.authorize;
    state.authorized = true;
    state.loginid    = auth.loginid;
    state.balance    = parseFloat(auth.balance);
    state.currency   = auth.currency;

    log(`✅ Authorized: ${auth.loginid} | Balance: ${auth.balance} ${auth.currency}`, "ok");
    broadcast({ type: "AUTHORIZED", loginid: auth.loginid, balance: auth.balance, currency: auth.currency });

    // Subscribe balance
    sendDeriv({ balance: 1, subscribe: 1, req_id: nextId() });

    // Subscribe ticks
    subscribeTicks(state.symbol);

    // ★ KEY: if bot was running before disconnect, auto-restart it
    if (state.botRunning && state.botSettings) {
      log("🤖 Bot was running — auto-restarting after reconnect...", "ok");
      setTimeout(() => startBot(), 2000);
    }
    return;
  }

  // BALANCE
  if (data.msg_type === "balance") {
    state.balance = parseFloat(data.balance.balance);
    broadcast({ type: "BALANCE_UPDATE", balance: state.balance, currency: state.currency });
    return;
  }

  // TICK
  if (data.msg_type === "tick") {
    const price = parseFloat(data.tick.quote);
    state.lastPrice    = state.currentPrice || price;
    state.currentPrice = price;

    state.tickBuffer.push(price);
    if (state.tickBuffer.length > 300) state.tickBuffer.shift();

    state.priceHistory.push(price);
    if (state.priceHistory.length > 100) state.priceHistory.shift();

    broadcast({ type: "TICK", price, symbol: data.tick.symbol });

    // Check daily reset on every tick
    checkDailyReset();

    // Run bot logic on every tick
    if (state.botRunning && !state.paused) {
      runBotLogic();
    }
    return;
  }

  // TICKS HISTORY
  if (data.msg_type === "ticks_history" && data.history) {
    const prices       = data.history.prices.map(parseFloat);
    state.tickBuffer   = prices;
    state.priceHistory = prices.slice(-100);
    broadcast({ type: "PRICE_HISTORY", prices: state.priceHistory });
    return;
  }

  // BUY (trade placed)
  if (data.msg_type === "buy") {
    const contract = data.buy;
    state.activeContractId = contract.contract_id;

    const trade = {
      openTime:   Date.now(),
      direction:  state.activeTrade?.direction || "BUY",
      stake:      state.stake,
      entryPrice: state.currentPrice,
      status:     "open",
    };
    state.activeTrade = trade;
    state.todayTradeCount++;

    log(`📈 Trade opened: ${trade.direction} | $${trade.stake} | Entry: ${trade.entryPrice}`, "ok");
    broadcast({ type: "TRADE_OPENED", trade });

    // Subscribe to contract live updates
    sendDeriv({ proposal_open_contract: 1, contract_id: state.activeContractId, subscribe: 1, req_id: nextId() });
    return;
  }

  // CONTRACT UPDATE
  if (data.msg_type === "proposal_open_contract") {
    const poc = data.proposal_open_contract;
    if (!poc) return;
    broadcast({ type: "CONTRACT_UPDATE", contract: poc });
    if (poc.is_expired || poc.is_sold || poc.status === "won" || poc.status === "lost") {
      handleContractClose(poc);
    }
    return;
  }
}

// ─────────────────────────────────────────────
// HANDLE CONTRACT CLOSE
// ─────────────────────────────────────────────
function handleContractClose(poc) {
  if (!state.activeTrade) return;

  const isWin  = poc.status === "won" || (poc.profit && parseFloat(poc.profit) > 0);
  const profit = poc.profit
    ? parseFloat(poc.profit)
    : (isWin ? state.stake * 0.85 : -state.stake);

  const trade = {
    ...state.activeTrade,
    exitPrice: poc.sell_price || state.currentPrice,
    profit:    parseFloat(profit.toFixed(2)),
    status:    isWin ? "win" : "loss",
  };

  state.trades.unshift(trade);
  if (state.trades.length > 200) state.trades.pop();

  state.todayPnl += profit;

  if (isWin) {
    state.todayWins++;
    state.consecutiveLosses = 0;
    state.currentStreak++;
    if (state.currentStreak > state.bestStreak) state.bestStreak = state.currentStreak;
    // Reset martingale on win
    state.martStep = 0;
    state.stake    = state.baseStake;
  } else {
    state.todayLosses++;
    state.currentStreak = 0;
    state.consecutiveLosses++;

    // Martingale
    if (state.martingaleEnabled && state.martStep < state.martingaleMaxSteps) {
      state.martStep++;
      state.stake = parseFloat((state.baseStake * Math.pow(state.martingaleMultiplier, state.martStep)).toFixed(2));
      log(`🔄 Martingale step ${state.martStep}: Stake → $${state.stake}`, "warn");
    }

    // Pause on 3 consecutive losses
    if (state.pauseOn3Losses && state.consecutiveLosses >= 3) {
      state.paused = true;
      log("⏸️ 3 losses in a row — pausing 60s then auto-resuming", "warn");
      clearTimeout(state.pauseTimer);
      state.pauseTimer = setTimeout(() => {
        state.paused           = false;
        state.consecutiveLosses = 0;
        log("▶️ Bot resumed after 60s cooldown", "ok");
        broadcast({ type: "BOT_RESUMED" });
      }, 60000);
    }
  }

  const stats            = getStats();
  state.activeTrade      = null;
  state.activeContractId = null;

  log(`${isWin ? "✅ WIN" : "❌ LOSS"} | P&L: ${profit >= 0 ? "+" : ""}$${profit.toFixed(2)} | Today: $${state.todayPnl.toFixed(2)}`, isWin ? "ok" : "err");
  broadcast({ type: "TRADE_CLOSED", trade, stats });

  // Check daily limits — if hit, pause until tomorrow (not stop forever)
  if (state.todayTradeCount >= state.maxTradesPerDay) {
    log("📊 Max daily trades reached — pausing until tomorrow midnight", "warn");
    pauseUntilMidnight("Max daily trades reached");
    return;
  }
  if (state.todayPnl <= -Math.abs(state.dailyLossLimit)) {
    log("🛑 Daily loss limit hit — pausing until tomorrow midnight", "err");
    pauseUntilMidnight("Daily loss limit reached");
    return;
  }
}

// Pause bot until next midnight then auto-resume
function pauseUntilMidnight(reason) {
  state.paused = true;
  broadcast({ type: "BOT_PAUSED", reason });

  const now       = new Date();
  const midnight  = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 1, 0, 0); // 12:01 AM next day
  const msUntil   = midnight - now;

  log(`⏸️ ${reason} — auto-resuming at midnight (${Math.round(msUntil / 60000)} mins)`, "warn");

  clearTimeout(state.pauseTimer);
  state.pauseTimer = setTimeout(() => {
    checkDailyReset();
    state.paused            = false;
    state.consecutiveLosses = 0;
    state.martStep          = 0;
    state.stake             = state.baseStake;
    log("🌅 New day — bot auto-resumed!", "ok");
    broadcast({ type: "BOT_RESUMED", reason: "New day started" });
  }, msUntil);
}

// ─────────────────────────────────────────────
// SUBSCRIBE TICKS
// ─────────────────────────────────────────────
function subscribeTicks(symbol) {
  sendDeriv({ ticks_history: symbol, count: 200, end: "latest", style: "ticks", req_id: nextId() });
  sendDeriv({ ticks: symbol, subscribe: 1, req_id: nextId() });
  log(`📡 Subscribed: ${symbol}`, "ok");
}

// ─────────────────────────────────────────────
// BOT LOGIC — runs on every tick
// ─────────────────────────────────────────────
function runBotLogic() {
  if (!state.authorized || !state.botRunning || state.paused) return;
  if (state.activeTrade)      return; // already in trade
  if (state.todayTradeCount  >= state.maxTradesPerDay)     return;
  if (state.todayPnl         <= -Math.abs(state.dailyLossLimit)) return;

  // Rate limit signals — max 1 per 3 seconds
  const now = Date.now();
  if (now - state.lastSignalTime < 3000) return;
  state.lastSignalTime = now;

  const analysis = analyzeSignal();
  broadcast({ type: "SIGNAL_UPDATE", analysis });

  if (analysis.signal === "WAIT" || analysis.strength < 50) return;

  let contractType = state.contractType;
  if (contractType === "AUTO") {
    contractType = analysis.signal === "BUY" ? "CALL" : "PUT";
  }

  placeTrade(contractType, analysis.signal);
}

// ─────────────────────────────────────────────
// PLACE TRADE
// ─────────────────────────────────────────────
function placeTrade(contractType, direction) {
  if (!state.authorized) { log("Not authorized — skipping trade", "err"); return; }

  state.activeTrade = {
    openTime:   Date.now(),
    direction,
    stake:      state.stake,
    entryPrice: state.currentPrice,
    status:     "open",
  };

  log(`🚀 Placing ${direction} | ${contractType} | $${state.stake}`, "info");

  sendDeriv({
    buy:   1,
    price: state.stake,
    parameters: {
      contract_type: contractType,
      symbol:        state.symbol,
      duration:      state.duration,
      duration_unit: state.durationUnit,
      basis:         "stake",
      amount:        state.stake,
      currency:      state.currency,
    },
    req_id: nextId(),
  });
}

// ─────────────────────────────────────────────
// APPLY SETTINGS
// ─────────────────────────────────────────────
function applySettings(s) {
  if (s.symbol             !== undefined) state.symbol             = s.symbol;
  if (s.strategy           !== undefined) state.strategy           = s.strategy;
  if (s.stake              !== undefined) { state.stake = parseFloat(s.stake); state.baseStake = state.stake; }
  if (s.stopLossPct        !== undefined) state.stopLossPct        = parseFloat(s.stopLossPct);
  if (s.takeProfitPct      !== undefined) state.takeProfitPct      = parseFloat(s.takeProfitPct);
  if (s.maxTradesPerDay    !== undefined) state.maxTradesPerDay    = parseInt(s.maxTradesPerDay);
  if (s.dailyLossLimit     !== undefined) state.dailyLossLimit     = parseFloat(s.dailyLossLimit);
  if (s.martingaleEnabled  !== undefined) state.martingaleEnabled  = s.martingaleEnabled;
  if (s.martingaleMultiplier !== undefined) state.martingaleMultiplier = parseFloat(s.martingaleMultiplier);
  if (s.martingaleMaxSteps !== undefined) state.martingaleMaxSteps = parseInt(s.martingaleMaxSteps);
  if (s.contractType       !== undefined) state.contractType       = s.contractType;
  if (s.duration           !== undefined) state.duration           = parseInt(s.duration);
  if (s.durationUnit       !== undefined) state.durationUnit       = s.durationUnit;
  if (s.pauseOn3Losses     !== undefined) state.pauseOn3Losses     = s.pauseOn3Losses;

  // Save settings so bot can restore after reconnect
  state.botSettings = { ...s };
}

// ─────────────────────────────────────────────
// BOT CONTROL
// ─────────────────────────────────────────────
function startBot() {
  state.botRunning = true;
  state.paused     = false;
  state.martStep   = 0;
  state.stake      = state.baseStake;

  broadcast({ type: "BOT_STATUS", running: true });
  log("🤖 Bot STARTED — running 24/7", "ok");
}

function stopBot() {
  state.botRunning  = false;
  state.botSettings = null; // clear saved settings so it doesn't auto-restart
  clearTimeout(state.pauseTimer);
  broadcast({ type: "BOT_STATUS", running: false });
  log("⏹️ Bot manually stopped", "warn");
}

function emergencyStop() {
  stopBot();
  if (state.activeContractId) {
    sendDeriv({ sell: state.activeContractId, price: 0, req_id: nextId() });
  }
  state.activeTrade      = null;
  state.activeContractId = null;
  broadcast({ type: "EMERGENCY_STOP" });
  log("🚨 EMERGENCY STOP", "err");
}

// ─────────────────────────────────────────────
// BROWSER WEBSOCKET
// ─────────────────────────────────────────────
wss.on("connection", (browserWs) => {
  state.browserClients.add(browserWs);
  console.log(`[+] Browser connected (${state.browserClients.size} total)`);

  // Send complete current state to new browser connection
  browserWs.send(JSON.stringify({
    type:  "FULL_STATE",
    state: {
      authorized:   state.authorized,
      loginid:      state.loginid,
      balance:      state.balance,
      currency:     state.currency,
      botRunning:   state.botRunning,
      paused:       state.paused,
      symbol:       state.symbol,
      trades:       state.trades.slice(0, 50),
      stats:        getStats(),
      priceHistory: state.priceHistory,
      currentPrice: state.currentPrice,
    },
  }));

  browserWs.on("message", (raw) => {
    let cmd;
    try { cmd = JSON.parse(raw.toString()); } catch (_) { return; }

    switch (cmd.type) {
      case "CONNECT":
        connectDeriv(cmd.token);
        break;

      case "START_BOT":
        if (cmd.settings) applySettings(cmd.settings);
        startBot();
        break;

      case "STOP_BOT":
        stopBot();
        break;

      case "EMERGENCY_STOP":
        emergencyStop();
        break;

      case "CHANGE_SYMBOL":
        state.symbol = cmd.symbol;
        if (state.authorized) subscribeTicks(cmd.symbol);
        break;

      case "MANUAL_TRADE":
        if (!state.authorized) { log("Not connected", "err"); break; }
        if (state.activeTrade)  { log("Trade already open", "warn"); break; }
        placeTrade(cmd.direction === "BUY" ? "CALL" : "PUT", cmd.direction);
        break;
    }
  });

  browserWs.on("close", () => {
    state.browserClients.delete(browserWs);
    console.log(`[-] Browser disconnected (${state.browserClients.size} clients) — bot keeps running`);
    // ★ Bot KEEPS RUNNING even when browser closes
  });

  browserWs.on("error", () => state.browserClients.delete(browserWs));
});

// ─────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json({
    authorized:   state.authorized,
    loginid:      state.loginid,
    balance:      state.balance,
    currency:     state.currency,
    botRunning:   state.botRunning,
    paused:       state.paused,
    symbol:       state.symbol,
    strategy:     state.strategy,
    stake:        state.stake,
    stats:        getStats(),
    uptime:       process.uptime(),
  });
});

app.get("/api/trades", (req, res) => {
  res.json({ trades: state.trades.slice(0, 100) });
});

app.get("/api/signal", (req, res) => {
  res.json(analyzeSignal());
});

// Angular app
app.get("*", (req, res) => {
  const index = path.join(__dirname, "dist/derivbot-pro/browser/index.html");
  res.sendFile(index, (err) => {
    if (err) {
      res.send(`
        <html><body style="background:#07090f;color:#e8edf7;font-family:monospace;padding:40px;">
        <h2 style="color:#00ffaa">✅ DerivBot Pro Backend Running</h2>
        <p style="margin-top:12px;color:#6b7899">Bot status: <b style="color:#00ffaa">${state.botRunning ? "RUNNING 🟢" : "STOPPED 🔴"}</b></p>
        <p style="margin-top:8px;color:#6b7899">API: <a href="/api/status" style="color:#4f8ef7">/api/status</a></p>
        </body></html>
      `);
    }
  });
});

// ─────────────────────────────────────────────
// KEEP-ALIVE PING (prevents Render free tier sleep)
// ─────────────────────────────────────────────
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";

function keepAlive() {
  if (!RENDER_URL) return;
  https.get(`${RENDER_URL}/api/status`, (res) => {
    console.log(`[KEEP-ALIVE] ${new Date().toTimeString().slice(0,8)} — status ${res.statusCode}`);
  }).on("error", () => {});
}

// Ping every 10 minutes to prevent sleep
setInterval(keepAlive, 10 * 60 * 1000);

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   DerivBot Pro — 24/7 Auto-Run Server   ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Port     : ${PORT}                          ║`);
  console.log(`║  API      : /api/status                  ║`);
  console.log("║  Mode     : ALWAYS ON — never stops      ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("Waiting for user to connect via dashboard...");
});
