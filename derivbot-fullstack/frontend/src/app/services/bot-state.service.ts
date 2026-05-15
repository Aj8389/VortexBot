import { Injectable, signal } from '@angular/core';

export interface Trade {
  openTime?: number;
  direction: string;
  stake: number;
  entryPrice: number;
  exitPrice?: number;
  profit?: number;
  status: 'open' | 'win' | 'loss';
}

export interface Stats {
  wins: number;
  losses: number;
  total: number;
  pnl: number;
  winRate: number;
  bestStreak: number;
  remaining: number;
}

export interface SignalAnalysis {
  signal: 'BUY' | 'SELL' | 'WAIT';
  reason?: string;
  rsi: number;
  ema9: number;
  ema21: number;
  strength: number;
  macd: number;
}

@Injectable({ providedIn: 'root' })
export class BotStateService {
  // Connection
  connStatus = signal<'live' | 'connecting' | 'error' | ''>('');
  connLabel = signal('DISCONNECTED');
  derivConnected = signal(false);
  loginid = signal('');

  // Account
  balance = signal(0);
  currency = signal('USD');
  isLive = signal(false);

  // Bot
  botRunning = signal(false);
  selectedStrategy = signal('RSI_EMA');
  symbol = signal('R_100');

  // Market
  currentPrice = signal(0);
  lastPrice = signal(0);
  priceHistory = signal<number[]>([]);
  pnlHistory = signal<number[]>([0]);

  // Stats
  stats = signal<Stats>({ wins: 0, losses: 0, total: 0, pnl: 0, winRate: 0, bestStreak: 0, remaining: 10 });

  // Trades
  trades = signal<Trade[]>([]);
  activeTrade = signal<Trade | null>(null);

  // Signal analysis
  signalAnalysis = signal<SignalAnalysis | null>(null);

  // Logs
  logs = signal<{ time: string; msg: string; level: string }[]>([
    { time: '--:--:--', msg: 'DerivBot Pro ready. Paste API token to connect.', level: 'sys' },
    { time: '--:--:--', msg: 'WebSocket auto-connecting to backend...', level: 'info' }
  ]);

  addLog(msg: string, level = 'sys') {
    const time = new Date().toTimeString().slice(0, 8);
    this.logs.update(logs => [{ time, msg, level }, ...logs].slice(0, 80));
  }

  updateStats(s: Stats) { this.stats.set(s); }

  closeTrade(trade: Trade, stats: Stats) {
    this.activeTrade.set(null);
    this.trades.update(t => [trade, ...t]);
    this.updateStats(stats);
  }
}
