// Reads the map over HTTP Range: map.json and the four
// index files once per map version, then 2 KB slot groups and 16 KB title blocks from the data
// sites, with a shared search cache.
import { decodeSlotIndex, groupOf, maybeGunzip, type Group } from './layout.ts';
import { decodeKeyIndex, titleInGroup } from './titles.ts';
import type { SearchErrorReason } from './protocol.ts';

export type SlotTable = 'out' | 'in' | 'tid';
export type Table = SlotTable | 'tkey';

export interface Manifest {
  version: string;
  dumpDate: string;
  N: number;
  E: number;
  slotBytes: number;
  chunkBytes: number;
  tkeyBlockBytes: number;
  sites: string[];
  files: Record<Table, number[]>;
  slots: Record<SlotTable, number>;
  tkeyBlocks: number;
  index: Record<Table, string>;
}

// A failure the page shows as one of its map states
export class MapError extends Error {
  constructor(readonly reason: Exclude<SearchErrorReason, 'tooBig'>) {
    super(`map ${reason}`);
  }
}

// The search reached its hard byte cap
export class TooBigError extends Error {
  constructor() {
    super('map hard cap reached');
  }
}

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

// The byte budget of one search. reserve() is called before each request; past the cap it
// reports a pause once and waits for raise(); at the hard cap it throws.
export class ByteMeter {
  used = 0;
  private waiters: (() => void)[] = [];
  private paused = false;

  constructor(
    public cap: number,
    readonly hardCap: number,
    private readonly onPause: (used: number) => void,
  ) {
    this.cap = Math.min(cap, hardCap);
  }

  async reserve(bytes: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      // the first request of a search always goes, whatever its size
      if (this.used === 0 || this.used + bytes <= this.cap) {
        this.used += bytes;
        return;
      }
      if (this.cap >= this.hardCap) throw new TooBigError();
      if (!this.paused) {
        this.paused = true;
        this.onPause(this.used);
      }
      await new Promise<void>((resolve, reject) => {
        this.waiters.push(resolve);
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
  }

  raise(cap: number): void {
    this.cap = Math.min(Math.max(this.cap, cap), this.hardCap);
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}

// At most `max` requests in flight across every search and lookup
class Lanes {
  active = 0;
  peak = 0;
  private queue: (() => void)[] = [];

  constructor(readonly max: number) {}

  acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.max) {
      this.take();
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const go = () => {
        this.take();
        resolve();
      };
      this.queue.push(go);
      signal?.addEventListener(
        'abort',
        () => {
          const i = this.queue.indexOf(go);
          if (i >= 0) {
            this.queue.splice(i, 1);
            reject(signal.reason);
          }
        },
        { once: true },
      );
    });
  }

  private take() {
    this.active++;
    this.peak = Math.max(this.peak, this.active);
  }

  release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}

export interface ReaderOptions {
  // the site origin that serves map.json and the index files
  base: string;
  fetch?: typeof fetch;
  lanes?: number;
  // waits before the 2nd and 3rd attempt, plus up to `jitter` of each at random
  backoff?: [number, number];
  jitter?: number;
  // search cache bound
  cacheBytes?: number;
  // adjacent groups merge into one request up to this size
  maxRunBytes?: number;
  // keep the index files in the Cache API (browser only)
  cacheApi?: boolean;
  random?: () => number;
}

export interface ReadContext {
  signal?: AbortSignal;
  meter?: ByteMeter;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });

const INDEX_CACHE = 'wikiracer-map';

export class MapReader {
  manifest!: Manifest;
  index!: Record<SlotTable, Uint32Array>;
  keys!: string[];
  readonly lanes: Lanes;
  // requests sent, for tests and the slow-connection line
  requests = 0;
  private readonly fetchFn: typeof fetch;
  private readonly backoff: [number, number];
  private readonly jitter: number;
  private readonly cacheBytes: number;
  private readonly maxRunBytes: number;
  private readonly random: () => number;
  private readonly cache = new Map<string, Uint8Array>();
  private cacheSize = 0;
  private readonly pending = new Map<string, Promise<Uint8Array>>();
  private opening: Promise<void> | null = null;

  constructor(private readonly opts: ReaderOptions) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.lanes = new Lanes(opts.lanes ?? 32);
    this.backoff = opts.backoff ?? [500, 2000];
    this.jitter = opts.jitter ?? 0.5;
    this.cacheBytes = opts.cacheBytes ?? 64 * 1024 * 1024;
    this.maxRunBytes = opts.maxRunBytes ?? 1024 * 1024;
    this.random = opts.random ?? Math.random;
  }

  // Loads map.json and the index files once; a failed load is retried on the next call.
  open(): Promise<void> {
    this.opening ??= this.load().catch((e: unknown) => {
      this.opening = null;
      throw e;
    });
    return this.opening;
  }

  private async load(): Promise<void> {
    const m = await this.fetchManifest();
    const urls = { out: '', in: '', tid: '', tkey: '' } as Record<Table, string>;
    for (const t of Object.keys(urls) as Table[]) urls[t] = new URL(m.index[t], this.opts.base).href;
    const [out, inn, tid, tkey] = await Promise.all((['out', 'in', 'tid', 'tkey'] as Table[]).map((t) => this.fetchIndex(urls[t], Object.values(urls))));
    this.index = { out: decodeSlotIndex(out!), in: decodeSlotIndex(inn!), tid: decodeSlotIndex(tid!) };
    this.keys = decodeKeyIndex(tkey!);
    for (const t of ['out', 'in', 'tid'] as SlotTable[]) {
      if (this.index[t].length !== m.slots[t]) throw new MapError('unavailable');
    }
    this.manifest = m;
  }

  private async fetchManifest(): Promise<Manifest> {
    let res: Response;
    try {
      res = await this.fetchFn(new URL('map.json', this.opts.base).href, { cache: 'no-cache' });
    } catch {
      throw new MapError('unavailable');
    }
    if (!res.ok) throw new MapError('unavailable');
    return (await res.json()) as Manifest;
  }

  // An index file, from the Cache API when it's there (versioned URLs, so entries never go
  // stale; other versions' entries are deleted).
  private async fetchIndex(url: string, current: string[]): Promise<Uint8Array> {
    const store = this.opts.cacheApi !== false && typeof caches !== 'undefined' ? await caches.open(INDEX_CACHE).catch(() => null) : null;
    if (store) {
      const hit = await store.match(url);
      if (hit) return maybeGunzip(new Uint8Array(await hit.arrayBuffer()));
    }
    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch {
      throw new MapError('unavailable');
    }
    if (!res.ok) throw new MapError('unavailable');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (store) {
      await store.put(url, new Response(bytes)).catch(() => undefined);
      for (const req of await store.keys()) if (!current.includes(req.url)) await store.delete(req);
    }
    return maybeGunzip(bytes);
  }

  private chunkUrl(table: Table, k: number): string {
    const m = this.manifest;
    const site = m.sites[m.files[table][k]!]!;
    return `${site.endsWith('/') ? site : site + '/'}v${m.version}/${table}-${String(k).padStart(2, '0')}.bin`;
  }

  private cacheGet(key: string): Uint8Array | undefined {
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  private cachePut(key: string, bytes: Uint8Array): void {
    if (this.cache.has(key)) return;
    this.cache.set(key, bytes);
    this.cacheSize += bytes.length;
    for (const [k, v] of this.cache) {
      if (this.cacheSize <= this.cacheBytes) break;
      this.cache.delete(k);
      this.cacheSize -= v.length;
    }
  }

  // Reads the slot groups of a table, calling onGroup for each as it arrives. Cached groups are
  // delivered first; the rest are sorted, merged into runs of adjacent slots and fetched.
  async readGroups(table: SlotTable, groups: Group[], onGroup: (g: Group, bytes: Uint8Array) => void, ctx: ReadContext = {}): Promise<void> {
    const S = this.manifest.slotBytes;
    const waits: Promise<void>[] = [];
    const fresh: Group[] = [];
    for (const g of groups) {
      const key = `${table}:${g.slot}`;
      const hit = this.cacheGet(key);
      if (hit) {
        onGroup(g, hit);
        continue;
      }
      const p = this.pending.get(key);
      if (p) {
        // another read is fetching it; if that read is cancelled, fetch it for this one
        waits.push(
          p.then(
            (b) => onGroup(g, b),
            (e: unknown) => (isAbort(e) && !ctx.signal?.aborted ? this.readGroups(table, [g], onGroup, ctx) : Promise.reject(e)),
          ),
        );
      } else fresh.push(g);
    }
    fresh.sort((a, b) => a.slot - b.slot);
    const runs: Group[][] = [];
    for (const g of fresh) {
      const run = runs.at(-1);
      const last = run?.at(-1);
      if (run && last && last.slot + last.slots === g.slot && (g.slot + g.slots - run[0]!.slot) * S <= this.maxRunBytes) run.push(g);
      else runs.push([g]);
    }
    for (const run of runs) {
      const start = run[0]!.slot * S;
      const end = (run.at(-1)!.slot + run.at(-1)!.slots) * S;
      const fetched = this.fetchRange(table, start, end, ctx);
      for (const g of run) {
        const key = `${table}:${g.slot}`;
        const p = fetched.then((bytes) => {
          const own = bytes.slice(g.slot * S - start, (g.slot + g.slots) * S - start);
          this.cachePut(key, own);
          return own;
        });
        this.pending.set(key, p);
        void p.finally(() => this.pending.delete(key)).catch(() => undefined);
        waits.push(p.then((b) => onGroup(g, b)));
      }
    }
    await Promise.all(waits);
  }

  // One 16 KB title block
  readKeyBlock(block: number, ctx: ReadContext = {}): Promise<Uint8Array> {
    const key = `tkey:${block}`;
    const hit = this.cacheGet(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const B = this.manifest.tkeyBlockBytes;
    const p = this.fetchRange('tkey', block * B, (block + 1) * B, ctx).then((bytes) => {
      this.cachePut(key, bytes);
      return bytes;
    });
    this.pending.set(key, p);
    void p.finally(() => this.pending.delete(key)).catch(() => undefined);
    return p;
  }

  // id → title for each id
  async titles(ids: number[], ctx: ReadContext = {}): Promise<string[]> {
    const index = this.index.tid;
    const groups = new Map<number, Group>();
    const groupOfId = ids.map((id) => {
      const g = groupOf(index, id);
      groups.set(g.slot, g);
      return g.slot;
    });
    const bytes = new Map<number, Uint8Array>();
    await this.readGroups('tid', [...groups.values()], (g, b) => bytes.set(g.slot, b), ctx);
    return ids.map((id, i) => titleInGroup(bytes.get(groupOfId[i]!)!, groups.get(groupOfId[i]!)!.first, id));
  }

  // Bytes [start, end) of a table's chunked stream, split at chunk-file boundaries
  private async fetchRange(table: Table, start: number, end: number, ctx: ReadContext): Promise<Uint8Array> {
    const C = this.manifest.chunkBytes;
    const out = new Uint8Array(end - start);
    const pieces: Promise<void>[] = [];
    for (let pos = start; pos < end; ) {
      const k = Math.floor(pos / C);
      const to = Math.min(end, (k + 1) * C);
      const at = pos;
      pieces.push(this.requestPiece(table, k, at - k * C, to - k * C, ctx).then((b) => out.set(b, at - start)));
      pos = to;
    }
    await Promise.all(pieces);
    return out;
  }

  // One Range request within chunk file k, [from, to) in file offsets: 3 attempts with backoff;
  // a 200 (Range ignored) is never parsed; a 404 re-reads map.json.
  private async requestPiece(table: Table, k: number, from: number, to: number, ctx: ReadContext): Promise<Uint8Array> {
    const { signal, meter } = ctx;
    await meter?.reserve(to - from, signal);
    let had404 = false;
    for (let attempt = 0; attempt < 3; ) {
      await this.lanes.acquire(signal);
      let retry = true;
      try {
        this.requests++;
        const res = await this.fetchFn(this.chunkUrl(table, k), { headers: { Range: `bytes=${from}-${to - 1}` }, signal });
        if (res.status === 206) {
          // GitHub Pages doesn't expose Content-Range cross-origin, so when it reads as null only the
          // body length is checked; a same-origin or exposing host gets the full check.
          const range = res.headers.get('Content-Range');
          const m = range === null ? null : /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(range);
          if (range === null || (m && Number(m[1]) === from && Number(m[2]) === to - 1 && (m[3] === '*' || Number(m[3]) >= to))) {
            const body = new Uint8Array(await res.arrayBuffer());
            if (body.length === to - from) return body;
          } else await res.body?.cancel();
        } else if (res.status === 200) {
          // the host ignored Range: the body is the whole file and is never parsed
          await res.body?.cancel();
          throw new MapError('unavailable');
        } else if (res.status === 404) {
          await res.body?.cancel();
          if (had404) throw new MapError('maintenance');
          had404 = true;
          const m = await this.fetchManifest().catch(() => null);
          if (!m || m.version !== this.manifest.version) throw new MapError('maintenance');
          retry = false; // ask once more straight away; the same version still missing the file is maintenance
        } else {
          await res.body?.cancel();
        }
      } catch (e) {
        if (isAbort(e) || e instanceof MapError) throw e;
        // a network failure: retried below
      } finally {
        this.lanes.release();
      }
      if (!retry) continue;
      attempt++;
      if (attempt < 3) await sleep(this.backoff[attempt - 1]! * (1 + this.random() * this.jitter), signal);
    }
    throw new MapError('network');
  }
}
