// Game clock: time of day drives crowd density, light, shop hours, trains.
// One real second = `scale` game seconds (demo: 1.2, close to real time so
// walking never feels punished by the clock).
import { params } from './params.js?v=f150c03';
export class Clock {
  constructor(events) {
    this.events = events;
    this.scale = 1.2;
    let start = 11 * 60 + 20; // 11:20, just off the airport train, lunch ahead
    if (params.time) { const [h, m] = params.time.split(':').map(Number); start = h * 60 + (m || 0); }
    this.minutes = start;      // minutes since midnight (float)
    this._lastWhole = Math.floor(start);
    this.paused = false;
  }
  update(dt) {
    if (this.paused || params.freeze) return;
    this.minutes += dt * this.scale / 60;
    if (this.minutes >= 1440) this.minutes -= 1440;
    const whole = Math.floor(this.minutes);
    if (whole !== this._lastWhole) { this._lastWhole = whole; this.events.emit('time:tick', { minutes: whole }); }
  }
  get hours() { return this.minutes / 60; }
  get hhmm() { const m = Math.floor(this.minutes); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  // 0..1 rush factor: commuter peaks 7:30-9:30 and 17:30-19:30, lunch bump
  get rush() {
    const h = this.hours;
    const g = (c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w));
    return Math.min(1, 0.25 + 0.75 * Math.max(g(8.4, 0.8), g(18.4, 0.9)) + 0.3 * g(12.3, 0.7));
  }
}
