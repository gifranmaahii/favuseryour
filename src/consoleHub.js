'use strict';

const pter = require('./pterodactyl');
const config = require('./config');

/**
 * Singleton console connection.
 * - Maintains a ring buffer of last N console lines.
 * - Supports awaiting a regex pattern (for /pair code, etc.)
 * - Emits notifications for matching error/status patterns.
 */
class ConsoleHub {
  constructor({ bufferSize = 500 } = {}) {
    this.bufferSize = bufferSize;
    this.buffer = [];
    this.waiters = []; // { regex, timeoutId, resolve, reject, collected }
    this.notifiers = []; // (line) => void
    this.stateListeners = []; // (state) => void
    this.client = null;
    this.connecting = null;
    this.lastState = 'unknown';
  }

  pushLine(line) {
    if (!line && line !== '') return;
    const ts = Date.now();
    this.buffer.push({ ts, line });
    if (this.buffer.length > this.bufferSize) this.buffer.shift();

    // Notify subscribers
    for (const fn of this.notifiers) {
      try { fn(line); } catch (_) {}
    }

    // Resolve waiters
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      const m = line.match(w.regex);
      if (m) {
        clearTimeout(w.timeoutId);
        this.waiters.splice(i, 1);
        w.resolve({ match: m, line });
      }
    }
  }

  setState(state) {
    this.lastState = state;
    for (const fn of this.stateListeners) {
      try { fn(state); } catch (_) {}
    }
  }

  onLine(fn) { this.notifiers.push(fn); return () => {
    this.notifiers = this.notifiers.filter((f) => f !== fn);
  }; }

  onState(fn) { this.stateListeners.push(fn); return () => {
    this.stateListeners = this.stateListeners.filter((f) => f !== fn);
  }; }

  getRecent(n = 50) {
    return this.buffer.slice(-n).map((x) => x.line);
  }

  async ensureConnected() {
    if (this.client && this.client.isAlive()) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const c = await pter.connectConsole({
        onLine: (l) => this.pushLine(l),
        onState: (s) => this.setState(s),
        onClose: () => {
          this.client = null;
          // auto reconnect after delay
          setTimeout(() => {
            this.ensureConnected().catch((e) => console.error('[console] reconnect error:', e.message));
          }, 5000);
        },
        onError: (e) => console.error('[console] ws error:', e.message),
      });
      this.client = c;
      return c;
    })();
    try {
      const c = await this.connecting;
      return c;
    } finally {
      this.connecting = null;
    }
  }

  async sendCommand(cmd) {
    const c = await this.ensureConnected();
    c.send(cmd);
  }

  /**
   * Wait until a console line matches `regex`, or timeout.
   * Resolves with { match, line }.
   */
  waitFor(regex, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      // Check existing buffer first
      for (let i = this.buffer.length - 1; i >= 0; i--) {
        const m = this.buffer[i].line.match(regex);
        if (m) return resolve({ match: m, line: this.buffer[i].line });
      }
      const timeoutId = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timeoutId !== timeoutId);
        reject(new Error('Timeout waiting for console pattern'));
      }, timeoutMs);
      this.waiters.push({ regex, timeoutId, resolve, reject });
    });
  }
}

const hub = new ConsoleHub();

module.exports = hub;
