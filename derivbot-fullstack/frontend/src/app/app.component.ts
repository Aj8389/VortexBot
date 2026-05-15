import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TopbarComponent } from './components/topbar/topbar.component';
import { LeftPanelComponent } from './components/left-panel/left-panel.component';
import { CenterComponent } from './components/center/center.component';
import { RightPanelComponent } from './components/right-panel/right-panel.component';
import { WebsocketService } from './services/websocket.service';
import { LogService } from './services/log.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, TopbarComponent, LeftPanelComponent, CenterComponent, RightPanelComponent],
  template: `
    <app-topbar></app-topbar>
    <div class="workspace">
      <app-left-panel></app-left-panel>
      <app-center></app-center>
      <app-right-panel></app-right-panel>
    </div>
    <div class="toast" [class]="'toast ' + toastType() + (toastVisible() ? ' show' : '')">
      {{ toastMsg() }}
    </div>
    <div class="backend-bar" [class]="'backend-bar ' + backendType()">
      {{ backendText() }}
    </div>
  `
})
export class AppComponent implements OnInit {
  toastMsg     = signal('');
  toastType    = signal('ok');
  toastVisible = signal(false);
  backendText  = signal('⚠ Connecting to backend...');
  backendType  = signal('info');
  private toastTimer: any;

  constructor(private ws: WebsocketService, private log: LogService) {}

  ngOnInit() {
    this.ws.onToast         = (msg, type) => this.showToast(msg, type);
    this.ws.onBackendStatus = (text, type) => { this.backendText.set(text); this.backendType.set(type); };

    // Auto-detect correct WebSocket URL:
    // On Render: same host, wss://yourapp.onrender.com
    // Local dev on :4200: connect to localhost:3000
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host     = location.hostname;
    const port     = location.port === '4200' ? ':3000' : (location.port ? `:${location.port}` : '');
    const wsUrl    = `${protocol}//${host}${port}`;

    this.log.add(`Connecting to: ${wsUrl}`, 'info');
    this.ws.connect(wsUrl);
  }

  showToast(msg: string, type = 'ok') {
    this.toastMsg.set(msg);
    this.toastType.set(type);
    this.toastVisible.set(true);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastVisible.set(false), 3500);
  }
}
