import { Injectable, OnDestroy } from '@angular/core';
import { BotStateService, Stats, Trade, SignalAnalysis } from './bot-state.service';
import { LogService } from './log.service';
import { TokenService } from './token.service';

@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: any  = null;
  private wsUrl = 'ws://localhost:3000';

  onBackendStatus?: (text: string, type: string) => void;
  onToast?:         (msg: string,  type: string) => void;

  constructor(
    private state: BotStateService,
    private log:   LogService,
    private token: TokenService
  ) {}

  connect(url?: string) {
    if (url) this.wsUrl = url;
    if (this.ws) { try { this.ws.close(); } catch (_) {} }

    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.log.add('✅ Backend connected', 'ok');
      this.onBackendStatus?.('✓ Backend connected — DerivBot Pro ready', 'ok');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

      const saved = this.token.load();
      if (saved) {
        this.state.connStatus.set('connecting');
        this.state.connLabel.set('CONNECTING...');
        this.send({ type: 'CONNECT', token: saved });
        this.log.add('Auto-connecting with saved token...', 'info');
      }
    };

    this.ws.onmessage = (evt) => {
      let msg: any;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }
      this.handleMessage(msg);
    };

    this.ws.onerror = () => {
      this.onBackendStatus?.('✗ Backend not reachable', 'err');
      this.log.add('Backend connection failed', 'err');
    };

    this.ws.onclose = () => {
      this.log.add('Backend disconnected — retrying in 5s...', 'warn');
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    };
  }

  send(payload: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      this.log.add('Backend not connected', 'err');
    }
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'FULL_STATE':
        this.onFullState(msg.state);
        break;

      case 'CONN_STATUS':
        this.state.connStatus.set(msg.status);
        this.state.connLabel.set(msg.label);
        break;

      case 'AUTHORIZED':
        this.onAuthorized(msg);
        break;

      case 'BALANCE_UPDATE':
        this.state.balance.set(parseFloat(msg.balance));
        if (msg.currency) this.state.currency.set(msg.currency);
        break;

      case 'PRICE_HISTORY':
        this.state.priceHistory.set(msg.prices);
        break;

      case 'TICK':
        this.onTick(msg);
        break;

      case 'SIGNAL_UPDATE':
        this.state.signalAnalysis.set(msg.analysis as SignalAnalysis);
        break;

      case 'BOT_STATUS':
        this.state.botRunning.set(msg.running);
        if (msg.running) {
          this.log.add('🤖 Bot is RUNNING — trades 24/7 automatically', 'ok');
          this.onToast?.('Bot started — running 24/7!', 'ok');
        } else {
          this.log.add('Bot stopped', 'warn');
        }
        break;

      case 'BOT_PAUSED':
        this.log.add(`⏸️ Bot paused: ${msg.reason}`, 'warn');
        this.onToast?.(`Bot paused: ${msg.reason}`, 'warn');
        break;

      case 'BOT_RESUMED':
        this.log.add('▶️ Bot auto-resumed!', 'ok');
        this.onToast?.('Bot auto-resumed ✓', 'ok');
        break;

      case 'STATS_RESET':
        this.log.add('📅 Daily stats reset — new day', 'info');
        break;

      case 'TRADE_OPENED':
        this.state.activeTrade.set(msg.trade);
        this.log.add(`📈 Trade: ${msg.trade.direction} $${msg.trade.stake}`, 'ok');
        break;

      case 'CONTRACT_UPDATE':
        break;

      case 'TRADE_CLOSED':
        this.onTradeClosed(msg);
        break;

      case 'EMERGENCY_STOP':
        this.state.activeTrade.set(null);
        this.state.botRunning.set(false);
        this.onToast?.('🚨 Emergency stop!', 'err');
        break;

      case 'INVALID_TOKEN':
        this.token.remove();
        this.state.derivConnected.set(false);
        this.state.connStatus.set('error');
        this.state.connLabel.set('INVALID TOKEN');
        this.state.isLive.set(false);
        this.log.add('❌ Invalid token — please enter a valid Deriv API token', 'err');
        this.onToast?.('Invalid token! Please reconnect.', 'err');
        break;

      case 'LOG':
        this.log.add(msg.msg, msg.level);
        break;
    }
  }

  private onFullState(s: any) {
    if (s.authorized) {
      this.state.connStatus.set('live');
      this.state.connLabel.set('LIVE: ' + s.loginid);
      this.state.isLive.set(true);
      this.state.derivConnected.set(true);
    }
    if (s.balance  != null) this.state.balance.set(parseFloat(s.balance));
    if (s.currency)          this.state.currency.set(s.currency);
    if (s.trades?.length)    this.state.trades.set(s.trades);
    if (s.priceHistory?.length) this.state.priceHistory.set(s.priceHistory);
    if (s.currentPrice)      this.state.currentPrice.set(s.currentPrice);
    if (s.stats)             this.state.updateStats(s.stats);
    if (s.botRunning)        this.state.botRunning.set(true);
    if (s.loginid)           this.state.loginid.set(s.loginid);

    // If bot is already running on server (you left it running), show that
    if (s.botRunning) {
      this.log.add('🤖 Bot is already running on server', 'ok');
      this.onToast?.('Bot is running on server ✓', 'ok');
    }
  }

  private onAuthorized(msg: any) {
    this.state.derivConnected.set(true);
    this.state.connStatus.set('live');
    this.state.connLabel.set('LIVE: ' + msg.loginid);
    this.state.loginid.set(msg.loginid);
    this.state.balance.set(parseFloat(msg.balance));
    this.state.currency.set(msg.currency);
    this.state.isLive.set(true);
    this.log.add(`✅ Connected: ${msg.loginid} | ${msg.balance} ${msg.currency}`, 'ok');
    this.onToast?.('Connected! Account: ' + msg.loginid, 'ok');
  }

  private onTick(msg: any) {
    this.state.lastPrice.set(this.state.currentPrice());
    this.state.currentPrice.set(msg.price);
    this.state.priceHistory.update(h => {
      const next = [...h, msg.price];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }

  private onTradeClosed(msg: any) {
    const trade = msg.trade as Trade;
    const stats = msg.stats as Stats;
    this.state.closeTrade(trade, stats);
    this.state.pnlHistory.update(h => [...h, stats.pnl]);
    const win = trade.status === 'win';
    this.log.add(`${win ? '✅ WIN' : '❌ LOSS'} | P&L: ${win ? '+' : '-'}$${Math.abs(trade.profit!).toFixed(2)}`, win ? 'ok' : 'err');
    this.onToast?.(
      win ? `✅ WIN +$${Math.abs(trade.profit!).toFixed(2)}` : `❌ LOSS -$${Math.abs(trade.profit!).toFixed(2)}`,
      win ? 'ok' : 'err'
    );
  }

  ngOnDestroy() {
    this.ws?.close();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }
}
