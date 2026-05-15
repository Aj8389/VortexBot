import { Injectable } from '@angular/core';
import { BotStateService } from './bot-state.service';

@Injectable({ providedIn: 'root' })
export class LogService {
  constructor(private state: BotStateService) {}

  add(msg: string, level = 'sys') {
    this.state.addLog(msg, level);
  }
}
