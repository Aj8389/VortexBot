import { Component, OnInit, OnDestroy, signal, effect } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { BotStateService, Trade } from '../../services/bot-state.service';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-center',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './center.component.html',
  styleUrls: ['./center.component.scss']
})
export class CenterComponent implements OnInit, OnDestroy {
  private mainChart: Chart | null = null;
  private pnlChart: Chart | null = null;

  tradeFilter = signal<'all' | 'open' | 'win' | 'loss'>('all');
  stats = this.state.stats;
  currentPrice = this.state.currentPrice;
  lastPrice = this.state.lastPrice;

  get priceUp() { return this.currentPrice() >= this.lastPrice(); }
  get pctDisplay() {
    const lp = this.lastPrice();
    const cp = this.currentPrice();
    if (!lp) return '+0.000%';
    const pct = ((cp - lp) / lp * 100).toFixed(3);
    return (this.priceUp ? '+' : '') + pct + '%';
  }
  get filteredTrades() {
    const f = this.tradeFilter();
    const t = this.state.trades();
    if (f === 'open') return t.filter(x => x.status === 'open');
    if (f === 'win') return t.filter(x => x.status === 'win');
    if (f === 'loss') return t.filter(x => x.status === 'loss');
    return t;
  }

  constructor(public state: BotStateService) {
    effect(() => { this.updateMainChart(this.state.priceHistory()); });
    effect(() => { this.updatePnlChart(this.state.pnlHistory()); });
  }

  ngOnInit() {
    setTimeout(() => this.initCharts(), 120);
  }

  initCharts() {
    const ctx1 = (document.getElementById('mc') as HTMLCanvasElement)?.getContext('2d');
    if (ctx1) {
      this.mainChart = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            data: [],
            borderColor: '#00ffaa',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.2,
            fill: { target: 'origin', above: 'rgba(0,255,170,0.04)' } as any
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { position: 'right', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#5a6b8a', font: { size: 9, family: 'IBM Plex Mono' }, maxTicksLimit: 4 } }
          }
        }
      });
    }

    const ctx2 = (document.getElementById('pnlC2') as HTMLCanvasElement)?.getContext('2d');
    if (ctx2) {
      this.pnlChart = new Chart(ctx2, {
        type: 'line',
        data: {
          labels: ['Start'],
          datasets: [{
            data: [0],
            borderColor: '#3d8bff',
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: { target: 'origin', above: 'rgba(61,139,255,0.06)', below: 'rgba(255,51,85,0.06)' } as any
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#5a6b8a', font: { size: 8, family: 'IBM Plex Mono' }, maxTicksLimit: 3 } }
          }
        }
      });
    }
  }

  private updateMainChart(prices: number[]) {
    if (!this.mainChart || !prices.length) return;
    const up = this.currentPrice() >= this.lastPrice();
    this.mainChart.data.labels = prices.map((_, i) => i);
    this.mainChart.data.datasets[0].data = prices;
    this.mainChart.data.datasets[0].borderColor = up ? '#00ffaa' : '#ff3355';
    (this.mainChart.data.datasets[0] as any).fill = { target: 'origin', above: up ? 'rgba(0,255,170,0.04)' : 'rgba(255,51,85,0.04)' };
    this.mainChart.update('none');
  }

  private updatePnlChart(history: number[]) {
    if (!this.pnlChart) return;
    const pnl = history[history.length - 1] || 0;
    this.pnlChart.data.labels = history.map((_, i) => i === 0 ? 'Start' : 'T' + i);
    this.pnlChart.data.datasets[0].data = history;
    this.pnlChart.data.datasets[0].borderColor = pnl >= 0 ? '#00ffaa' : '#ff3355';
    this.pnlChart.update('none');
  }

  setFilter(f: 'all' | 'open' | 'win' | 'loss') { this.tradeFilter.set(f); }
  tradeTime(t: Trade) { return t.openTime ? new Date(t.openTime).toTimeString().slice(0, 8) : '--:--:--'; }
  tradeResult(t: Trade) { return t.status === 'win' ? 'WIN' : t.status === 'loss' ? 'LOSS' : 'OPEN'; }
  tradePnl(t: Trade) {
    if (t.profit === undefined) return '—';
    return (t.profit >= 0 ? '+' : '') + '$' + Math.abs(t.profit).toFixed(2);
  }
  tradeExit(t: Trade) { return t.exitPrice !== undefined ? parseFloat(String(t.exitPrice)).toFixed(2) : '—'; }

  ngOnDestroy() {
    this.mainChart?.destroy();
    this.pnlChart?.destroy();
  }
}
