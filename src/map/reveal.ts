// Directs one reveal: takes the search's levels as they come (or all at once,
// re-timed, when they were buffered), then runs the breakthrough, draws the shortest route, lands
// the par and draws the player's route. Stop titles are DOM labels over the canvas, placed each
// frame, with the ones that would overlap a more important label hidden.
import type { Dag } from '../search/protocol.ts';
import { LiveTimer, retime, type LevelBatch } from './playback.ts';
import { MapRenderer, REVEAL } from './renderer.ts';
import type { Tier } from './tiers.ts';

export type RevealBeat = 'fronts' | 'breakthrough' | 'par' | 'yours' | 'settled';

export interface Label {
  text: string;
  x: number;
  y: number;
  // the shortest route's stops ('route'), the player's own stops ('yours'); start and finish ('end')
  kind: 'end' | 'route' | 'yours';
  hidden: boolean;
}

export interface DirectorOptions {
  tier: Tier;
  reducedMotion: boolean;
  onBeat(beat: RevealBeat): void;
  onLabels(labels: Label[]): void;
  onFallback(): void;
}

const MAX_LABELS = 12;
const LABEL_H = 18;

export class RevealDirector {
  readonly renderer: MapRenderer;
  private readonly live = new LiveTimer();
  private lastBirth = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private pendingLabels: { text: string; kind: Label['kind']; pos: [number, number]; width: number }[] = [];
  private beat: RevealBeat = 'fronts';
  private finished = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: DirectorOptions,
  ) {
    this.renderer = new MapRenderer(canvas, {
      tier: opts.tier,
      reducedMotion: opts.reducedMotion,
      onFallback: opts.onFallback,
      onFrame: () => this.placeLabels(),
    });
  }

  get drawBudget(): number {
    return this.renderer.tier.drawBudget;
  }

  // Levels are held for `ms` first: a search that finishes inside the hold is re-timed like a
  // buffered one (about 3 s), and one still running then plays live from what has arrived.
  private held: LevelBatch[] | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  hold(ms: number): void {
    this.held = [];
    this.holdTimer = setTimeout(() => this.release(), ms);
  }

  addLevel(b: LevelBatch): void {
    if (this.held) this.held.push(b);
    else this.addLive(b);
  }

  // The search has posted its last level
  searchDone(): void {
    if (!this.held) return;
    clearTimeout(this.holdTimer);
    const held = this.held;
    this.held = null;
    this.addBuffered(held);
  }

  private release() {
    const held = this.held ?? [];
    this.held = null;
    for (const b of held) this.addLive(b);
  }

  // A level from a search still running: it starts now, or when the previous level has finished.
  addLive(b: LevelBatch): void {
    const births = this.live.next(b, this.renderer.now());
    this.track(births);
    this.renderer.addBatch(b, births);
  }

  // Levels buffered while the player raced: re-spread over about 3 s.
  addBuffered(batches: LevelBatch[]): void {
    const births = retime(batches, this.renderer.now() + 200);
    batches.forEach((b, i) => {
      this.track(births[i]!);
      this.renderer.addBatch(b, births[i]!);
    });
  }

  private track(births: Float32Array) {
    for (let i = 0; i < births.length; i++) if (births[i]! > this.lastBirth) this.lastBirth = births[i]!;
  }

  // The search is done: once the fronts have landed, the breakthrough, then the shortest route
  // (stop titles in `titles`), the par, then the player's route if there is one. Player stops that
  // aren't map articles carry null.
  finale(dag: Dag | null, featured: number[] | null, titles: string[], player: { ids: (number | null)[]; titles: string[] } | null): void {
    const r = this.renderer;
    const at = Math.max(r.now(), this.lastBirth + 700);
    if (dag) r.setDag(dag);
    let fake = -1;
    const playerIds = player?.ids.map((id) => id ?? fake--) ?? null;
    if (featured) r.setCourse(0, featured, REVEAL.shortest);
    if (playerIds) r.setCourse(1, playerIds, REVEAL.players[0]!);

    const shortestMs = this.opts.reducedMotion ? 200 : 900;
    const parAt = at + 300 + shortestMs;
    const yoursAt = parAt + 500;
    const settleAt = (playerIds ? yoursAt + shortestMs : parAt) + 600;
    this.after(at, () => {
      this.set('breakthrough');
      r.breakthrough();
      if (featured) r.drawCourse(0, r.now() + 300);
    });
    this.after(at + 300, () => {
      this.pendingLabels = [];
      if (featured) this.addLabels(r.coursePositions(0), titles, 'route');
      if (playerIds && player) {
        const onRoute = new Set(featured ?? []);
        const pos = r.coursePositions(1);
        player.titles.forEach((t, i) => {
          if (i > 0 && i < player.titles.length - 1 && !onRoute.has(playerIds[i]!)) this.pendingLabels.push(this.labelAt(t, 'yours', pos[i]!));
        });
      }
    });
    this.after(parAt, () => this.set('par'));
    if (playerIds) this.after(yoursAt, () => (this.set('yours'), r.drawCourse(1, r.now())));
    this.after(settleAt, () => this.settle());
  }

  // No route, or an error: the fronts stay as they are and the reveal settles once they've landed.
  settleWhenLanded(): void {
    this.after(Math.max(this.renderer.now(), this.lastBirth + 700), () => this.settle());
  }

  // Skips to the end state (a tap or any key).
  skip(): void {
    for (const t of this.timers) clearTimeout(t);
    const pending = this.timers.length > 0;
    this.timers = [];
    if (pending) this.runPending();
    this.renderer.skipToEnd();
    if (this.beat !== 'fronts') this.settle();
  }

  private pending: { at: number; fn: () => void }[] = [];

  private after(at: number, fn: () => void) {
    this.pending.push({ at, fn });
    this.timers.push(
      setTimeout(() => {
        this.pending = this.pending.filter((p) => p.fn !== fn);
        fn();
      }, Math.max(0, at - this.renderer.now())),
    );
  }

  private runPending() {
    const all = this.pending.sort((a, b) => a.at - b.at);
    this.pending = [];
    for (const p of all) p.fn();
  }

  private settle() {
    if (this.finished) return;
    this.finished = true;
    this.set('settled');
  }

  private set(b: RevealBeat) {
    if (this.beat === 'settled') return;
    this.beat = b;
    this.opts.onBeat(b);
  }

  private labelAt(text: string, kind: Label['kind'], pos: [number, number]) {
    // a width estimate is enough for overlap tests (Mona Sans width 87.5 at 13 px)
    return { text, kind, pos, width: text.length * 6.4 + 8 };
  }

  private addLabels(positions: [number, number][], titles: string[], kind: Label['kind']) {
    positions.forEach((p, i) => {
      const t = titles[i];
      if (t) this.pendingLabels.push(this.labelAt(t, i === 0 || i === positions.length - 1 ? 'end' : kind, p));
    });
  }

  // Greedy: start, finish and the shortest route's stops first, then the player's; a label that
  // would overlap one already placed is hidden. At most MAX_LABELS show.
  private placeLabels() {
    if (!this.pendingLabels.length) return;
    const order = { end: 0, route: 1, yours: 2 } as const;
    const queued = [...this.pendingLabels].sort((a, b) => order[a.kind] - order[b.kind]);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const w = this.canvas.clientWidth;
    const out: Label[] = queued.map((s) => {
      const p = this.renderer.project(s.pos);
      const x0 = Math.min(Math.max(4, p.x - s.width / 2), w - 4 - s.width), y0 = p.y - 10 - LABEL_H;
      const box = { x0, x1: x0 + s.width, y0, y1: y0 + LABEL_H };
      const hidden = placed.length >= MAX_LABELS || placed.some((q) => box.x0 < q.x1 && q.x0 < box.x1 && box.y0 < q.y1 && q.y0 < box.y1);
      if (!hidden) placed.push(box);
      return { text: s.text, kind: s.kind, x: x0, y: y0, hidden };
    });
    this.opts.onLabels(out);
  }

  destroy(): void {
    clearTimeout(this.holdTimer);
    for (const t of this.timers) clearTimeout(t);
    this.renderer.destroy();
  }
}
