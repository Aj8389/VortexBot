import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BotStateService } from '../../services/bot-state.service';

@Component({
  selector: 'app-right-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './right-panel.component.html',
  styleUrls: ['./right-panel.component.scss']
})
export class RightPanelComponent {
  signal = this.state.signalAnalysis;
  activeTrade = this.state.activeTrade;
  stats = this.state.stats;
  logs = this.state.logs;

  get signalClass() {
    const s = this.signal();
    if (!s) return 'NONE';
    return s.signal === 'WAIT' ? 'WAIT' : s.signal;
  }

  get signalText() {
    const s = this.signal();
    if (!s) return 'WAITING';
    return s.signal === 'WAIT' ? 'SCANNING...' : (s.signal === 'BUY' ? '▲ BUY' : '▼ SELL');
  }

  get signalIcon() {
    const s = this.signal();
    if (!s) return '⚡';
    return s.signal === 'BUY' ? '▲' : s.signal === 'SELL' ? '▼' : '⚡';
  }

  get rsiFillWidth() { const s = this.signal(); return s ? s.rsi : 50; }
  get rsiFillColor() {
    const r = this.signal()?.rsi ?? 50;
    return r < 30 ? 'var(--green)' : r > 70 ? 'var(--red)' : 'var(--amber)';
  }
  get emaTrend() { const s = this.signal(); if (!s) return '—'; return s.ema9 > s.ema21 ? 'Bull' : 'Bear'; }
  get emaFillWidth() { return this.emaTrend === 'Bull' ? 70 : 30; }
  get emaFillColor() { return this.emaTrend === 'Bull' ? 'var(--green)' : 'var(--red)'; }
  get strengthFillWidth() { return this.signal()?.strength ?? 0; }
  get strengthFillColor() {
    const s = this.signal()?.strength ?? 0;
    return s > 70 ? 'var(--green)' : s > 45 ? 'var(--amber)' : 'var(--muted)';
  }
  get macdDisplay() { return (this.signal()?.macd ?? 0).toFixed(4); }
  get macdFillWidth() { return Math.max(10, Math.min(90, 50 + (this.signal()?.macd ?? 0) * 100)); }
  get macdFillColor() { return (this.signal()?.macd ?? 0) > 0 ? 'var(--green)' : 'var(--red)'; }

  get wrCircleOffset() {
    const wr = this.stats().winRate || 0;
    return 175.9 - (175.9 * wr / 100);
  }
  get wrCircleColor() {
    const wr = this.stats().winRate || 0;
    return wr >= 65 ? 'var(--green)' : wr >= 50 ? 'var(--amber)' : 'var(--red)';
  }
  get pnlDisplay() {
    const p = this.stats().pnl;
    return (p >= 0 ? '+' : '') + '$' + Math.abs(p).toFixed(2);
  }

  constructor(public state: BotStateService) {}
}
