# DerivBot Pro — Fullstack Integration Guide

## Architecture

```
Browser (Angular)  ←→  Node.js Backend  ←→  Deriv WebSocket API
   :4200 / :3000         :3000               wss://ws.binaryws.com
```

**Two ways to run this:**

- **Development** — Angular dev server on port 4200, backend on port 3000 (separate terminals)  
- **Production** — Build Angular, then everything served from port 3000

---

## Quick Start

### Step 1 — Install dependencies

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Step 2 — Run in development mode (two terminals)

**Terminal 1 — Backend:**
```bash
node server.js
```

**Terminal 2 — Frontend (Angular dev server):**
```bash
cd frontend
npm start
```

Then open **http://localhost:4200**

> The Angular frontend automatically connects to `ws://localhost:3000` when running on port 4200.

---

### Run in production mode (single server)

```bash
# Build the Angular app
npm run build

# Start the server (serves Angular + WebSocket on port 3000)
node server.js
```

Then open **http://localhost:3000**

---

## How to Connect & Use

1. **Open the dashboard** in your browser
2. **Paste your Deriv API Token** in the left panel  
   - Get it from: https://app.deriv.com → API Token → Enable **Read** + **Trade** permissions
3. **Click CONNECT** — the bot will authorize and start streaming live prices
4. **Configure your settings:**
   - Choose Asset (Volatility 100, Boom/Crash, Forex)
   - Select Strategy (RSI+EMA, Bollinger, MACD, Scalper)
   - Set Stake, Stop Loss %, Take Profit %
   - Enable Martingale if desired
5. **Click START BOT** — it will auto-trade based on signals

---

## What Was Integrated

### Frontend → Backend Connection
- `websocket.service.ts` now auto-detects the backend URL:
  - Dev mode (port 4200) → connects to `ws://localhost:3000`
  - Production (served by server.js) → connects to same host/port
- Removed hardcoded `wss://deriv-bot-pexb.onrender.com`

### Backend Enhancements (`server.js`)
- **Signal Analysis Engine** — RSI, EMA (9/21), MACD, Bollinger Bands computed on live ticks
- **All 4 strategies implemented:** RSI+EMA, Bollinger Breakout, MACD Divergence, Tick Scalper
- **Trade Execution** — sends real `buy` contracts via Deriv API
- **Contract Monitoring** — subscribes to `proposal_open_contract` for live P&L
- **Martingale** — doubles/multiplies stake after losses, resets on win
- **Risk Management** — daily trade limit, daily loss limit, 3-loss pause
- **Manual Trade** — supports `MANUAL_TRADE` message from topbar BUY/SELL buttons
- **Static File Serving** — serves Angular build from `dist/derivbot-pro/browser/`
- **REST Endpoints** — `/api/status`, `/api/trades`, `/api/signal`

### Angular App Shell
- `app.component.ts` wired up with real components (was still showing Angular placeholder)
- `bot-state.service.ts` added `symbol` signal (used by center panel)
- `center.component.ts` updated to show current symbol in trade table
- All component styles consolidated into global `styles.scss`

---

## Message Protocol (Browser ↔ Backend)

### Browser → Backend
| Message | Description |
|---------|-------------|
| `{ type: 'CONNECT', token }` | Authorize with Deriv API token |
| `{ type: 'START_BOT', settings }` | Start bot with settings object |
| `{ type: 'STOP_BOT' }` | Stop bot |
| `{ type: 'EMERGENCY_STOP' }` | Force stop + close open trade |
| `{ type: 'CHANGE_SYMBOL', symbol }` | Switch market asset |
| `{ type: 'MANUAL_TRADE', direction }` | Manual BUY or SELL |

### Backend → Browser
| Message | Description |
|---------|-------------|
| `FULL_STATE` | Sent on connect — complete state snapshot |
| `AUTHORIZED` | Deriv auth success with account info |
| `CONN_STATUS` | Connection status changes |
| `BALANCE_UPDATE` | Live balance update |
| `TICK` | Price tick update |
| `PRICE_HISTORY` | Initial price history array |
| `SIGNAL_UPDATE` | Signal analysis (RSI, EMA, MACD, strength) |
| `BOT_STATUS` | Bot started/stopped |
| `TRADE_OPENED` | New trade opened |
| `CONTRACT_UPDATE` | Live contract P&L |
| `TRADE_CLOSED` | Trade result + updated stats |
| `EMERGENCY_STOP` | Emergency stop broadcast |
| `LOG` | Server log entry |

---

## File Structure

```
derivbot-fullstack/
├── server.js              ← Node.js backend (WebSocket + REST + static serving)
├── package.json           ← Backend dependencies
├── README.md
└── frontend/              ← Angular 17 app
    ├── src/
    │   ├── styles.scss    ← All global styles (dark trading theme)
    │   └── app/
    │       ├── app.component.ts        ← Root (auto-detects WS URL)
    │       ├── services/
    │       │   ├── websocket.service.ts  ← Backend WS client
    │       │   ├── bot-state.service.ts  ← Angular signals state
    │       │   ├── log.service.ts
    │       │   └── token.service.ts      ← localStorage token
    │       └── components/
    │           ├── topbar/    ← Connection pill, balance, manual trade buttons
    │           ├── left-panel/ ← Token, market, risk, strategy, bot controls
    │           ├── center/    ← Price chart, stats bar, P&L chart, trade history
    │           └── right-panel/ ← Signal display, indicators, win rate, log
    └── angular.json / tsconfig*.json / package.json
```
