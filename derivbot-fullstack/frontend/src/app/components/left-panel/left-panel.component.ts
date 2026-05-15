import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BotStateService } from '../../services/bot-state.service';
import { WebsocketService } from '../../services/websocket.service';
import { LogService } from '../../services/log.service';
import { TokenService } from '../../services/token.service';

@Component({
  selector: 'app-left-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './left-panel.component.html',
  styleUrls: ['./left-panel.component.scss']
})
export class LeftPanelComponent {
  apiToken = signal(this.token.load());
  tokenSaved = signal(!!this.token.load());
  tokenMsg = signal(this.token.load() ? '✓ Token saved — auto-connecting...' : '');

  symbol = signal('R_100');
  contractType = signal('AUTO');
  duration = signal('1m');
  stake = signal(10);
  stopLoss = signal(15);
  takeProfit = signal(30);
  maxTrades = signal(10);
  dailyLimit = signal(100);
  martEnabled = signal(false);
  martMultiplier = signal(2.0);
  martMaxSteps = signal(3);
  autoBuy = signal(true);
  autoExit = signal(true);
  pauseOnLoss = signal(true);
  selectedStrategy = signal('RSI_EMA');

  strategies = [
    { id: 'RSI_EMA',   name: 'RSI + EMA Cross',     desc: 'RSI overbought/oversold with EMA trend filter', wr: '68–72%', risk: 'Medium' },
    { id: 'BOLLINGER', name: 'Bollinger Breakout',   desc: 'Price breakout above/below Bollinger Bands',    wr: '65–70%', risk: 'Low' },
    { id: 'MACD',      name: 'MACD Divergence',      desc: 'MACD histogram crossover signal',               wr: '62–68%', risk: 'Medium' },
    { id: 'SCALPER',   name: 'Tick Scalper',         desc: 'Fast tick-by-tick micro-reversal system',       wr: '55–65%', risk: 'High' },
  ];

  get slAmount() { return (this.stake() * this.stopLoss() / 100).toFixed(2); }
  get tpAmount() { return (this.stake() * this.takeProfit() / 100).toFixed(2); }
  get botRunning() { return this.state.botRunning; }
  get derivConnected() { return this.state.derivConnected; }

  constructor(
    private state: BotStateService,
    private ws: WebsocketService,
    private log: LogService,
    private token: TokenService
  ) {}

  doConnect() {
    const tok = this.apiToken().trim();
    if (!tok) return;
    this.token.save(tok);
    this.tokenSaved.set(true);
    this.tokenMsg.set('✓ Connecting...');
    this.state.connStatus.set('connecting');
    this.state.connLabel.set('CONNECTING...');
    this.ws.send({ type: 'CONNECT', token: tok });
    this.log.add('Sending auth request to backend...', 'info');
  }

  clearToken() {
    this.token.remove();
    this.apiToken.set('');
    this.tokenSaved.set(false);
    this.tokenMsg.set('');
    this.state.derivConnected.set(false);
    this.state.connStatus.set('');
    this.state.connLabel.set('DISCONNECTED');
    this.state.isLive.set(false);
    this.log.add('Token removed', 'warn');
  }

  selectStrategy(id: string) {
    this.selectedStrategy.set(id);
    this.state.selectedStrategy.set(id);
    const s = this.strategies.find(s => s.id === id);
    this.log.add('Strategy: ' + (s?.name || id), 'info');
  }

  changeSymbol() {
    this.state.symbol.set(this.symbol());
    this.ws.send({ type: 'CHANGE_SYMBOL', symbol: this.symbol() });
  }

  startBot() {
    const [dur, unit] = this.parseDuration(this.duration());
    this.ws.send({
      type: 'START_BOT',
      settings: {
        symbol: this.symbol(),
        strategy: this.selectedStrategy(),
        stake: this.stake(),
        stopLossPct: this.stopLoss(),
        takeProfitPct: this.takeProfit(),
        maxTradesPerDay: this.maxTrades(),
        dailyLossLimit: this.dailyLimit(),
        martingaleEnabled: this.martEnabled(),
        martingaleMultiplier: this.martMultiplier(),
        martingaleMaxSteps: this.martMaxSteps(),
        contractType: this.contractType(),
        duration: dur,
        durationUnit: unit,
        pauseOn3Losses: this.pauseOnLoss(),
      }
    });
  }

  stopBot() { this.ws.send({ type: 'STOP_BOT' }); }
  emergencyStop() { this.ws.send({ type: 'EMERGENCY_STOP' }); this.log.add('Emergency stop triggered', 'err'); }

  private parseDuration(val: string): [number, string] {
    const m = val.match(/^(\d+)([tm])$/);
    return m ? [parseInt(m[1]), m[2]] : [1, 'm'];
  }
}
