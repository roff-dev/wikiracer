// A live room's connection. It says hello with the seat token, keeps the offset to the room's
// clock from that round trip, pings every 30 s (reconnecting if no pong comes within 10 s) and
// reconnects after a drop with backoff 1, 2, 4, 8, then every 15 s. The latest move and any
// finish or give-up are sent again after a reconnect; the room keeps the highest count.
import { clockOffset } from '../../worker/names.ts';
import type { ClientMessage, ErrorCode, RoomState, ServerMessage, StandingRow } from '../../worker/protocol.ts';

export interface RoomEvents {
  welcome(you: number, state: RoomState): void;
  state(state: RoomState): void;
  standings(round: number, rows: StandingRow[]): void;
  error(code: ErrorCode): void;
  connection(status: 'connecting' | 'open' | 'lost'): void;
}

const BACKOFF = [1000, 2000, 4000, 8000];
const RETRY_EVERY = 15_000;
const PING_EVERY = 30_000;
const PONG_WITHIN = 10_000;
// closed by the room: expired (4000) or refused a seat (4001); these aren't retried
const FINAL = new Set([4000, 4001]);

export class RoomSocket {
  // the room's clock minus this device's
  offset = 0;
  you: number | null = null;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private sentAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pinger: ReturnType<typeof setInterval> | undefined;
  private pongWait: ReturnType<typeof setTimeout> | undefined;
  private lastMove: ClientMessage | null = null;
  private ending: ClientMessage | null = null;

  constructor(
    private readonly code: string,
    private readonly seat: string,
    private name: string,
    private readonly on: RoomEvents,
    private readonly base = location.origin.replace(/^http/, 'ws'),
  ) {}

  connect(): void {
    this.stopped = false;
    this.on.connection('connecting');
    const ws = new WebSocket(`${this.base}/api/course/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.sentAt = Date.now();
      ws.send(JSON.stringify({ t: 'hello', seat: this.seat, name: this.name } satisfies ClientMessage));
      clearInterval(this.pinger);
      this.pinger = setInterval(() => this.ping(), PING_EVERY);
    };
    ws.onmessage = (e) => this.receive(String(e.data));
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.pinger);
      this.ws = null;
      if (this.stopped || FINAL.has(e.code)) return;
      this.on.connection('lost');
      const delay = BACKOFF[this.attempt] ?? RETRY_EVERY;
      this.attempt++;
      this.timers.push(setTimeout(() => this.connect(), delay));
    };
  }

  private ping() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send('ping');
    const ws = this.ws;
    clearTimeout(this.pongWait);
    this.pongWait = setTimeout(() => ws === this.ws && ws.close(4002, 'no pong'), PONG_WITHIN);
  }

  private receive(text: string) {
    if (text === 'pong') {
      clearTimeout(this.pongWait);
      return;
    }
    let m: ServerMessage;
    try {
      m = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    switch (m.t) {
      case 'welcome':
        this.offset = clockOffset(m.now, this.sentAt, Date.now());
        this.you = m.you;
        this.attempt = 0;
        this.on.connection('open');
        this.on.welcome(m.you, m.state);
        for (const again of [this.lastMove, this.ending]) if (again) this.ws?.send(JSON.stringify(again));
        break;
      case 'state': {
        const { t: _, ...state } = m;
        this.on.state(state);
        break;
      }
      case 'standings':
        this.on.standings(m.round, m.rows);
        break;
      case 'error':
        this.on.error(m.code);
        break;
    }
  }

  send(m: ClientMessage): void {
    if (m.t === 'move') this.lastMove = m;
    if (m.t === 'finish' || m.t === 'giveup') this.ending = m;
    if (m.t === 'course' || m.t === 'start') {
      // a new round: nothing of the last one to send again
      this.lastMove = null;
      this.ending = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  // A new round starts for everyone, not only the host who sent start
  newRound(): void {
    this.lastMove = null;
    this.ending = null;
  }

  // Local time for a moment on the room's clock
  local(roomTime: number): number {
    return roomTime - this.offset;
  }

  leave(): void {
    this.send({ t: 'leave' });
    this.close();
  }

  close(): void {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    clearInterval(this.pinger);
    clearTimeout(this.pongWait);
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }
}
