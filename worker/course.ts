import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index.ts';
import { MAX_FRAME, type ClientMessage, type ErrorCode, type Mode, type ServerMessage } from './protocol.ts';
import {
  addResult,
  challengeTable,
  countMessage,
  createRoom,
  disconnect,
  endRound,
  expired,
  finish,
  giveUp,
  join,
  leave,
  move,
  nextAlarm,
  phaseAt,
  setCourse,
  setLimit,
  setScoring,
  standings,
  start,
  stateOf,
  strike,
  type ChallengeResult,
  type Outcome,
  type RateWindow,
  type Room,
} from './rules.ts';

// What a socket carries through hibernation: its seat once it has said hello, and its rate window
interface Attachment {
  n: number | null;
  rate: RateWindow | null;
}

// Close codes: the room has gone, or this socket can't have a seat
const CLOSE_EXPIRED = 4000;
const CLOSE_REFUSED = 4001;
const CLOSE_RATE = 1008;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// One object per room or challenge code. The room (course, seats, this round's runs) is one small
// JSON row; each move is a row, so a given-up run's route and every hop can be rebuilt. No timers:
// one alarm holds the next deadline, so the object can hibernate between messages.
export class Course extends DurableObject<Env> {
  private room: Room | null = null;
  private results: ChallengeResult[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
      sql.exec('CREATE TABLE IF NOT EXISTS moves (round INTEGER, n INTEGER, click INTEGER, title TEXT, at INTEGER, PRIMARY KEY (round, n, click))');
      for (const row of sql.exec<{ key: string; value: string }>('SELECT key, value FROM meta')) {
        if (row.key === 'room') this.room = JSON.parse(row.value) as Room;
        if (row.key === 'results') this.results = JSON.parse(row.value) as ChallengeResult[];
      }
    });
    // The runtime answers heartbeats without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private save(room: Room) {
    this.room = room;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('room', ?)", JSON.stringify(room));
    void this.ctx.storage.setAlarm(nextAlarm(room));
  }

  // The room, unless it has expired (an alarm can run late)
  private live(now: number): Room | null {
    return this.room && !expired(this.room, now) ? this.room : null;
  }

  // Called once by the Worker for a new code; false when the code is already taken
  async init(mode: Mode, from: string, to: string, owner: string | null): Promise<boolean> {
    if (this.room) return false;
    this.save(createRoom(mode, from, to, Date.now(), owner));
    return true;
  }

  // GET /api/course/:code. Routes only for a seat with its own challenge result, or after a round.
  async info(hash: string | null) {
    const now = Date.now();
    const room = this.live(now);
    if (!room) return null;
    const base = { mode: room.mode, from: room.from, to: room.to, created: room.created };
    if (room.mode === 'challenge') return { ...base, ...challengeTable(this.results, hash) };
    return { ...base, ...stateOf(room, now) };
  }

  async addResult(hash: string, body: Record<string, unknown>): Promise<{ ok: true; table: ReturnType<typeof challengeTable> } | { ok: false; code: ErrorCode }> {
    const now = Date.now();
    const room = this.live(now);
    if (!room) return { ok: false, code: 'expired' };
    if (room.mode !== 'challenge') return { ok: false, code: 'bad' };
    const out = addResult(room, this.results, { hash, name: body.name, status: body.status, clicks: body.clicks, timeMs: body.timeMs, route: body.route }, now);
    if (!out.ok) return out;
    this.results = out.results;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('results', ?)", JSON.stringify(out.results));
    this.save({ ...room, lastActivity: now });
    return { ok: true, table: challengeTable(this.results, hash) };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const room = this.live(Date.now());
    if (!room || room.mode !== 'live') return new Response('not found', { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ n: null, rate: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // the socket closed meanwhile
    }
  }

  private seated(): [WebSocket, number][] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a?.n ? [[ws, a.n] as [WebSocket, number]] : [];
    });
  }

  private routeOf(round: number, from: string) {
    return (n: number) => [from, ...this.ctx.storage.sql.exec<{ title: string }>('SELECT title FROM moves WHERE round = ? AND n = ? ORDER BY click', round, n).toArray().map((r) => r.title)];
  }

  // Everyone gets the new state; when a round has just ended, the standings too
  private broadcast(before: Room | null, room: Room, now: number) {
    const state = stateOf(room, now);
    const ended = room.stage === 'standings' && before?.stage === 'round';
    const rows = ended ? standings(room, this.routeOf(room.round, room.from)) : null;
    for (const [ws] of this.seated()) {
      this.send(ws, { t: 'state', ...state });
      if (rows) this.send(ws, { t: 'standings', round: room.round, rows });
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    const a = (ws.deserializeAttachment() as Attachment | null) ?? { n: null, rate: null };
    const room = this.live(now);
    if (!room) {
      this.send(ws, { t: 'error', code: 'expired' });
      ws.close(CLOSE_EXPIRED, 'expired');
      return;
    }

    const counted = countMessage(a.rate, now);
    a.rate = counted.window;
    ws.serializeAttachment(a);
    if (counted.over) {
      if (a.n) {
        const s = strike(room, a.n);
        this.save(disconnect(s.room, a.n, now));
        if (s.code) this.send(ws, { t: 'error', code: s.code });
        this.broadcast(room, this.room!, now);
      }
      ws.close(CLOSE_RATE, 'too many messages');
      return;
    }

    let msg: ClientMessage;
    try {
      if (typeof raw !== 'string' || raw.length > MAX_FRAME) throw new Error('frame');
      msg = JSON.parse(raw) as ClientMessage;
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') throw new Error('shape');
    } catch {
      this.send(ws, { t: 'error', code: 'bad' });
      return;
    }

    if (msg.t === 'hello') {
      if (typeof msg.seat !== 'string' || !/^[\w-]{16,128}$/.test(msg.seat) || typeof msg.name !== 'string') {
        this.send(ws, { t: 'error', code: 'bad' });
        return;
      }
      const joined = join(room, await sha256(msg.seat), msg.name, now);
      if (!joined.ok) {
        this.send(ws, { t: 'error', code: joined.code });
        if (joined.code === 'full') ws.close(CLOSE_REFUSED, joined.code);
        return;
      }
      // a second socket for the same seat replaces the first
      for (const [other, n] of this.seated()) if (n === joined.n && other !== ws) other.close(CLOSE_REFUSED, 'replaced');
      a.n = joined.n;
      ws.serializeAttachment(a);
      this.save(joined.room);
      this.send(ws, { t: 'welcome', you: joined.n, now, state: stateOf(joined.room, now) });
      if (joined.room.stage === 'standings') this.send(ws, { t: 'standings', round: joined.room.round, rows: standings(joined.room, this.routeOf(joined.room.round, joined.room.from)) });
      this.broadcast(room, joined.room, now);
      return;
    }

    const n = a.n;
    if (!n) {
      this.send(ws, { t: 'error', code: 'bad' });
      return;
    }
    let out: Outcome;
    switch (msg.t) {
      case 'course':
        out = setCourse(room, n, msg.from, msg.to, now);
        break;
      case 'scoring':
        out = setScoring(room, n, msg.scoring, now);
        break;
      case 'limit':
        out = setLimit(room, n, msg.minutes, now);
        break;
      case 'start':
        out = start(room, n, now);
        break;
      case 'move':
        out = move(room, n, msg.click, msg.title, now);
        if (out.ok) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO moves (round, n, click, title, at) VALUES (?, ?, ?, ?, ?)', room.round, n, msg.click, msg.title, now);
        break;
      case 'finish':
        out = finish(room, n, { clicks: msg.clicks, timeMs: msg.timeMs, route: msg.route }, now);
        break;
      case 'giveup':
        out = giveUp(room, n, msg.clicks, now);
        break;
      case 'leave':
        out = { ok: true, room: leave(room, n, now) };
        a.n = null;
        ws.serializeAttachment(a);
        break;
      default:
        out = { ok: false, code: 'bad' };
    }
    if (!out.ok) {
      this.send(ws, { t: 'error', code: out.code });
      return;
    }
    // a move changes only a click count: everyone still gets it, so boards stay current
    this.save(out.room);
    this.broadcast(room, out.room, now);
    if (msg.t === 'leave') ws.close(1000, 'left');
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropped(ws);
  }

  private dropped(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment | null;
    const now = Date.now();
    const room = this.live(now);
    if (!room || !a?.n) return;
    // another socket may have taken the seat over already
    if (this.seated().some(([other, n]) => n === a.n && other !== ws)) return;
    const next = disconnect(room, a.n, now);
    this.save(next);
    this.broadcast(room, next, now);
  }

  // The round's time limit, or expiry 30 days after the last activity
  async alarm(): Promise<void> {
    const now = Date.now();
    const room = this.room;
    if (!room) return;
    if (expired(room, now)) {
      for (const ws of this.ctx.getWebSockets()) {
        this.send(ws, { t: 'error', code: 'expired' });
        ws.close(CLOSE_EXPIRED, 'expired');
      }
      this.room = null;
      this.results = [];
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (phaseAt(room, now) === 'race') {
      const next = endRound(room, now);
      if (next.stage !== room.stage) {
        this.save(next);
        this.broadcast(room, next, now);
        return;
      }
    }
    await this.ctx.storage.setAlarm(nextAlarm(room));
  }
}
