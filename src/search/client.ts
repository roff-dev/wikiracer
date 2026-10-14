// The page's side of the search worker: starts the worker and turns its messages into
// callbacks per search and promises per request. Stale ids are dropped.
import type { Dag, FromWorker, SearchErrorReason, Side, TitleHit, ToWorker } from './protocol.ts';

const MB = 1024 * 1024;
// per-search byte caps
export const BUDGET = { soft: 16 * MB, saveData: 4 * MB, hard: 64 * MB };

export interface SearchHandlers {
  onNodes?(side: Side, depth: number, ids: Int32Array, angles: Float32Array, parentAngles: Float32Array): void;
  onProgress?(explored: number, fetchedBytes: number): void;
  // paused at the soft cap: call keepGoing() to raise it to the hard cap
  onBudget?(fetchedBytes: number): void;
  onDone?(result: { distance: number | null; pathCount: number; explored: number; fetchedBytes: number; dag: Dag | null; featured: number[] | null }): void;
  onError?(reason: SearchErrorReason): void;
  onCancelled?(): void;
}

export interface SearchHandle {
  searchId: number;
  cancel(): void;
  keepGoing(): void;
}

type Pending = { resolve(msg: FromWorker): void; reject(e: Error): void };

// The search needs a module worker, gzip streams and fetch
export const supported = () => typeof Worker !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof fetch !== 'undefined';

const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export class SearchClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly searches = new Map<number, SearchHandlers>();
  private readonly requests = new Map<number, Pending>();

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  private send(m: ToWorker) {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker) {
    if ('reqId' in m) {
      const p = this.requests.get(m.reqId);
      if (!p) return;
      this.requests.delete(m.reqId);
      if (m.kind === 'requestError') p.reject(new Error(m.reason));
      else p.resolve(m);
      return;
    }
    const h = this.searches.get(m.searchId);
    if (!h) return;
    switch (m.kind) {
      case 'nodes':
        h.onNodes?.(m.side, m.depth, m.ids, m.angles, m.parentAngles);
        break;
      case 'progress':
        h.onProgress?.(m.explored, m.fetchedBytes);
        break;
      case 'budget':
        h.onBudget?.(m.fetchedBytes);
        break;
      case 'done':
        this.searches.delete(m.searchId);
        h.onDone?.(m);
        break;
      case 'error':
        this.searches.delete(m.searchId);
        h.onError?.(m.reason);
        break;
      case 'cancelled':
        this.searches.delete(m.searchId);
        h.onCancelled?.();
        break;
    }
  }

  search(from: number, to: number, drawBudget: number, handlers: SearchHandlers): SearchHandle {
    const searchId = this.nextId++;
    this.searches.set(searchId, handlers);
    this.send({ kind: 'search', searchId, from, to, drawBudget, budgetBytes: saveData() ? BUDGET.saveData : BUDGET.soft });
    return {
      searchId,
      cancel: () => this.send({ kind: 'cancel', searchId }),
      keepGoing: () => this.send({ kind: 'continue', searchId, budgetBytes: BUDGET.hard }),
    };
  }

  private request<K extends FromWorker['kind']>(m: ToWorker & { reqId: number }): Promise<Extract<FromWorker, { kind: K }>> {
    return new Promise((resolve, reject) => {
      this.requests.set(m.reqId, { resolve: resolve as (msg: FromWorker) => void, reject });
      this.send(m);
    });
  }

  async lookup(titles: string[]): Promise<(TitleHit | null)[]> {
    return (await this.request<'lookupResult'>({ kind: 'lookup', reqId: this.nextId++, titles })).results;
  }

  async prefix(q: string): Promise<TitleHit[]> {
    return (await this.request<'prefixResult'>({ kind: 'prefix', reqId: this.nextId++, q })).results;
  }

  async titles(ids: number[]): Promise<string[]> {
    return (await this.request<'titlesResult'>({ kind: 'titles', reqId: this.nextId++, ids })).titles;
  }

  async check(routes: string[][]): Promise<number[][]> {
    return (await this.request<'checkResult'>({ kind: 'check', reqId: this.nextId++, routes })).missing;
  }

  // Links leaving and reaching an article (the setter refuses a course no route can finish)
  async degrees(id: number): Promise<{ out: number; in: number }> {
    const r = await this.request<'degreesResult'>({ kind: 'degrees', reqId: this.nextId++, id });
    return { out: r.out, in: r.in };
  }

  terminate(): void {
    this.worker.terminate();
  }
}
