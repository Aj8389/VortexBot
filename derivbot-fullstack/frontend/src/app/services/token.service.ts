import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly KEY = 'derivbot_token';

  save(token: string): void {
    try { localStorage.setItem(this.KEY, token); } catch (_) {}
  }

  load(): string {
    try { return localStorage.getItem(this.KEY) || ''; } catch (_) { return ''; }
  }

  remove(): void {
    try { localStorage.removeItem(this.KEY); } catch (_) {}
  }
}
