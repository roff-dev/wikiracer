// One course's shortest-route search, kept outside any screen: the race starts it when the start
// card opens and buffers its levels, and the reveal plays them back whenever it opens (or live,
// if the player beat the search). Status changes and new levels go to the listeners.
import type { SearchClient, SearchHandle } from './client.ts';
import type { Dag, SearchErrorReason, Side } from './protocol.ts';

export interface Level {
  side: Side;
  depth: number;
  ids: Int32Array;
  angles: Float32Array;
  parentAngles: Float32Array;
}

export type SessionStatus =
  | { kind: 'loading' }
  | { kind: 'searching' }
  | { kind: 'budget'; mb: number }
  | { kind: 'found'; distance: number; pathCount: number; dag: Dag; featured: number[]; titles: string[] }
  | { kind: 'noRoute' }
  | { kind: 'notInMap'; title: string }
  | { kind: 'error'; reason: SearchErrorReason };

export type SessionEvent = { kind: 'restart' } | { kind: 'level'; level: Level } | { kind: 'status' } | { kind: 'progress' };

// Still running: the reveal keeps drawing what arrives
export const running = (s: SessionStatus) => s.kind === 'loading' || s.kind === 'searching' || s.kind === 'budget';

export class SearchSession {
  status: SessionStatus = { kind: 'loading' };
  levels: Level[] = [];
  explored = 0;
  // ids of the start and finish once looked up
  ends: [number, number] | null = null;
  private handle: SearchHandle | null = null;
  private listeners = new Set<(e: SessionEvent) => void>();
  private run = 0;

  constructor(
    readonly client: SearchClient,
    readonly from: string,
    readonly to: string,
    private readonly drawBudget: number,
  ) {}

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SessionEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private set(status: SessionStatus) {
    this.status = status;
    this.emit({ kind: 'status' });
  }

  // Starts (or restarts, after an error) the search
  async start(): Promise<void> {
    this.handle?.cancel();
    const run = ++this.run;
    const live = () => run === this.run;
    this.levels = [];
    this.explored = 0;
    this.emit({ kind: 'restart' });
    this.set({ kind: 'loading' });
    let hits;
    try {
      hits = await this.client.lookup([this.from, this.to]);
    } catch (e) {
      if (live()) this.set({ kind: 'error', reason: (e as Error).message as SearchErrorReason });
      return;
    }
    if (!live()) return;
    const [a, b] = hits;
    if (!a || !b) {
      this.set({ kind: 'notInMap', title: !a ? this.from : this.to });
      return;
    }
    this.ends = [a.id, b.id];
    this.set({ kind: 'searching' });
    this.handle = this.client.search(a.id, b.id, this.drawBudget, {
      onNodes: (side, depth, ids, angles, parentAngles) => {
        const level = { side, depth, ids, angles, parentAngles };
        this.levels.push(level);
        this.emit({ kind: 'level', level });
      },
      onProgress: (n) => {
        this.explored = n;
        this.emit({ kind: 'progress' });
      },
      onBudget: (bytes) => this.set({ kind: 'budget', mb: Math.round(bytes / 1048576) }),
      onError: (reason) => this.set({ kind: 'error', reason }),
      onDone: async (r) => {
        this.explored = r.explored;
        if (r.distance === null || !r.dag || !r.featured) {
          this.set({ kind: 'noRoute' });
          return;
        }
        let titles: string[];
        try {
          titles = await this.client.titles(r.featured);
        } catch (e) {
          if (live()) this.set({ kind: 'error', reason: (e as Error).message as SearchErrorReason });
          return;
        }
        if (live()) this.set({ kind: 'found', distance: r.distance, pathCount: r.pathCount, dag: r.dag, featured: r.featured, titles });
      },
    });
  }

  keepGoing(): void {
    this.handle?.keepGoing();
    this.set({ kind: 'searching' });
  }

  cancel(): void {
    this.run++;
    this.handle?.cancel();
    this.handle = null;
    this.listeners.clear();
  }
}
