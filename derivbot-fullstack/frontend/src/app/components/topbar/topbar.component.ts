import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BotStateService } from '../../services/bot-state.service';
import { WebsocketService } from '../../services/websocket.service';
import { LogService } from '../../services/log.service';
import { TokenService } from '../../services/token.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss']
})
export class TopbarComponent {
  connStatus = this.state.connStatus;
  connLabel = this.state.connLabel;
  balance = this.state.balance;
  currency = this.state.currency;
  isLive = this.state.isLive;
  derivConnected = this.state.derivConnected;

  constructor(
    public state: BotStateService,
    private ws: WebsocketService,
    private log: LogService,
    private token: TokenService
  ) {}

  manualBUY() {
    if (!this.derivConnected()) { return; }
    this.ws.send({ type: 'MANUAL_TRADE', direction: 'BUY' });
    this.log.add('Manual BUY sent', 'info');
  }

  manualSELL() {
    if (!this.derivConnected()) { return; }
    this.ws.send({ type: 'MANUAL_TRADE', direction: 'SELL' });
    this.log.add('Manual SELL sent', 'info');
  }
}
