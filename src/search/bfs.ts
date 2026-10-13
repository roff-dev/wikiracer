// The search behind the reveal: bidirectional BFS over the map with
// shortest-route counts, the drawn-node sample and its polar layout, DAG recovery, the featured
// route, and the hop check of players' routes. The pipeline uses the sampling and angle functions
// to record the home page's demo, so the demo is drawn like a live search.
import { readList, skipList } from './codec.ts';
import { groupOf, type Group } from './layout.ts';
import type { Dag, Side } from './protocol.ts';
import type { MapReader, ReadContext } from './reader.ts';

// murmur3's 32-bit finaliser: a fixed hash of a map id
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const ANGLE_SALT = 0x9e3779b9;

// How many of a level's `n` new articles to draw: 60% of the remaining budget, or all of what's
// left if the fronts met in this level.
export function drawCount(n: number, remaining: number, met: boolean): number {
  return Math.min(n, met ? remaining : Math.floor(0.6 * remaining));
}

// The same pair always draws the same picture: article `id` is drawn if its hash falls under k / n.
export function isDrawn(id: number, k: number, n: number): boolean {
  return fmix32(id) / 2 ** 32 < k / n;
}

// Polar position: the start's children spread over the full circle; deeper articles stay in
// their parent's sector, which halves with each level.
export function childAngle(id: number, depth: number, parentAngle: number): number {
  const h = fmix32((id ^ ANGLE_SALT) >>> 0) / 2 ** 32;
  if (depth === 1) return h * 2 * Math.PI;
  return parentAngle + ((h - 0.5) * Math.PI) / 2 ** (depth - 1);
}

// Per-article search records: seen maps a map id to its
// record + 1 (0 = unseen); records grow by doubling and only touched entries are reset.
export class SearchState {
  readonly seen: Int32Array;
  ids = new Int32Array(0);
  dep: [Int16Array, Int16Array] = [new Int16Array(0), new Int16Array(0)];
  cnt: [Float64Array, Float64Array] = [new Float64Array(0), new Float64Array(0)];
  ang: [Float32Array, Float32Array] = [new Float32Array(0), new Float32Array(0)];
  // the lowest-id discoverer in the article's level, so its angle doesn't depend on response order
  par: [Int32Array, Int32Array] = [new Int32Array(0), new Int32Array(0)];
  drawn = new Uint8Array(0);
  n = 0;

  constructor(N: number) {
    this.seen = new Int32Array(N);
    this.grow(1 << 14);
  }

  private grow(size: number) {
    const g = <T extends Int16Array | Int32Array | Float32Array | Float64Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(size);
      b.set(a);
      return b;
    };
    this.ids = g(this.ids, (n) => new Int32Array(n));
    this.dep = [g(this.dep[0], (n) => new Int16Array(n)), g(this.dep[1], (n) => new Int16Array(n))];
    this.cnt = [g(this.cnt[0], (n) => new Float64Array(n)), g(this.cnt[1], (n) => new Float64Array(n))];
    this.ang = [g(this.ang[0], (n) => new Float32Array(n)), g(this.ang[1], (n) => new Float32Array(n))];
    this.par = [g(this.par[0], (n) => new Int32Array(n)), g(this.par[1], (n) => new Int32Array(n))];
    this.drawn = g(this.drawn, (n) => new Uint8Array(n));
  }

  // Makes room for `more` new records, so array references taken after this stay valid.
  reserve(more: number): void {
    if (this.n + more > this.ids.length) {
      let size = this.ids.length;
      while (this.n + more > size) size *= 2;
      this.grow(size);
    }
  }

  find(id: number): number {
    return this.seen[id]! - 1;
  }

  // The record of `id`, created if new (call reserve first)
  rec(id: number): number {
    const r = this.seen[id]! - 1;
    if (r >= 0) return r;
    const n = this.n++;
    this.seen[id] = n + 1;
    this.ids[n] = id;
    this.dep[0][n] = -1;
    this.dep[1][n] = -1;
    this.cnt[0][n] = 0;
    this.cnt[1][n] = 0;
    this.drawn[n] = 0;
    return n;
  }

  reset(): void {
    for (let r = 0; r < this.n; r++) this.seen[this.ids[r]!] = 0;
    this.n = 0;
  }
}

const TABLE = ['out', 'in'] as const;

// Calls fn(u, list) for every id in `ids` (sorted ascending, distinct) with its out-list (side 0)
// or in-list (side 1), as each group arrives.
export async function forLists(reader: MapReader, side: Side, ids: ArrayLike<number>, fn: (u: number, list: Int32Array) => void, ctx: ReadContext): Promise<void> {
  const index = reader.index[TABLE[side]];
  const N = reader.manifest.N;
  const groups: Group[] = [];
  const members = new Map<number, number[]>();
  let end = -1;
  for (let i = 0; i < ids.length; i++) {
    const u = ids[i]!;
    if (u >= end) {
      const g = groupOf(index, u);
      groups.push(g);
      members.set(g.slot, []);
      end = g.slot + g.slots < index.length ? index[g.slot + g.slots]! : N;
    }
    members.get(groups.at(-1)!.slot)!.push(u);
  }
  await reader.readGroups(
    TABLE[side],
    groups,
    (g, bytes) => {
      if (ctx.signal?.aborted) return;
      const c = { bytes, pos: 0 };
      let id = g.first;
      for (const u of members.get(g.slot)!) {
        for (; id < u; id++) skipList(c);
        fn(u, readList(c));
        id++;
      }
    },
    ctx,
  );
}

export interface SearchRequest {
  from: number;
  to: number;
  drawBudget: number;
}

export interface SearchHooks {
  reader: MapReader;
  ctx: ReadContext;
  onNodes(side: Side, depth: number, ids: Int32Array, angles: Float32Array, parentAngles: Float32Array): void;
  onProgress(explored: number): void;
}

export interface SearchOutcome {
  // null when no route exists
  distance: number | null;
  pathCount: number;
  explored: number;
  dag: Dag | null;
  featured: number[] | null;
  // drawn nodes sampled to the budget (meeting and DAG nodes come on top when they're over it)
  sampled: number;
}

const sortedIds = (a: number[]) => Int32Array.from(a).sort();

// Runs one search. Throws AbortError when ctx.signal aborts, MapError / TooBigError from the reader.
// The caller resets `state` afterwards.
export async function runSearch(state: SearchState, req: SearchRequest, hooks: SearchHooks): Promise<SearchOutcome> {
  const { reader, ctx } = hooks;
  const { from: s, to: t } = req;
  const st = state;
  st.reserve(2);
  for (const [side, root] of [[0, s], [1, t]] as [Side, number][]) {
    const r = st.rec(root);
    st.dep[side][r] = 0;
    st.cnt[side][r] = 1;
    st.ang[side][r] = 0;
    st.par[side][r] = -1;
    st.drawn[r]! |= 1 << side;
    hooks.onNodes(side, 0, Int32Array.of(root), Float32Array.of(0), Float32Array.of(0));
  }
  if (s === t) {
    const dag: Dag = { ids: Int32Array.of(s), meeting: Int32Array.of(s), pos: Uint8Array.of(0), through: Float64Array.of(1), edges: new Int32Array(0) };
    return { distance: 0, pathCount: 1, explored: 1, dag, featured: [s], sampled: 1 };
  }
  const levels: [Int32Array[], Int32Array[]] = [[Int32Array.of(s)], [Int32Array.of(t)]];
  let remaining = Math.max(0, req.drawBudget - 2);
  let sampled = 2;
  let lastProgress = 0;

  for (;;) {
    const fronts = [levels[0].at(-1)!, levels[1].at(-1)!];
    if (!fronts[0].length || !fronts[1].length) {
      return { distance: null, pathCount: 0, explored: st.n, dag: null, featured: null, sampled };
    }
    // Expand the frontier with fewer articles; ties go forward
    const side: Side = fronts[0].length <= fronts[1].length ? 0 : 1;
    const other: Side = side === 0 ? 1 : 0;
    const depth = levels[side].length;
    const next: number[] = [];
    await forLists(
      reader,
      side,
      fronts[side],
      (u, list) => {
        st.reserve(list.length);
        const dep = st.dep[side], cnt = st.cnt[side], ang = st.ang[side], par = st.par[side];
        const ru = st.find(u);
        const cu = cnt[ru]!, au = ang[ru]!;
        for (let k = 0; k < list.length; k++) {
          const v = list[k]!;
          const rv = st.rec(v);
          const dv = dep[rv]!;
          if (dv === -1) {
            dep[rv] = depth;
            cnt[rv] = cu;
            par[rv] = u;
            ang[rv] = childAngle(v, depth, au);
            next.push(v);
          } else if (dv === depth) {
            cnt[rv] += cu;
            if (u < par[rv]!) {
              par[rv] = u;
              ang[rv] = childAngle(v, depth, au);
            }
          }
        }
        const now = Date.now();
        if (now - lastProgress > 100) {
          lastProgress = now;
          hooks.onProgress(st.n);
        }
      },
      ctx,
    );
    ctx.signal?.throwIfAborted();
    const level = sortedIds(next);
    levels[side].push(level);
    const otherDep = st.dep[other];
    const meet: number[] = [];
    for (const v of level) if (otherDep[st.find(v)]! >= 0) meet.push(v);

    // drawn sample: meeting articles always, then the hash sample, never
    // past the remaining budget
    const met = meet.length > 0;
    const n = level.length;
    const k = drawCount(n, remaining, met);
    const pick: number[] = [];
    for (const v of level) {
      const r = st.find(v);
      if (met && otherDep[r]! >= 0) pick.push(v);
    }
    let room = Math.max(0, remaining - pick.length);
    for (const v of level) {
      if (room === 0) break;
      const r = st.find(v);
      if (met && otherDep[r]! >= 0) continue;
      if (isDrawn(v, k, n)) {
        pick.push(v);
        room--;
      }
    }
    remaining = Math.max(0, remaining - pick.length);
    sampled += pick.length;
    emit(st, hooks, side, depth, pick);
    hooks.onProgress(st.n);

    if (met) {
      const Lf = levels[0].length - 1, Lb = levels[1].length - 1;
      let pathCount = 0;
      for (const v of meet) {
        const r = st.find(v);
        if (st.dep[0][r] !== Lf || st.dep[1][r] !== Lb) throw new Error('BFS invariant: meeting depth');
        pathCount += st.cnt[0][r]! * st.cnt[1][r]!;
      }
      const dag = await recoverDag(st, levels, meet, hooks);
      // DAG articles not drawn yet join the picture
      for (const side of [0, 1] as Side[]) {
        const byDepth = new Map<number, number[]>();
        for (let i = 0; i < dag.ids.length; i++) {
          const v = dag.ids[i]!;
          const r = st.find(v);
          const dp = st.dep[side][r]!;
          const onSide = side === 0 ? dag.pos[i]! <= Lf : dag.pos[i]! > Lf;
          if (!onSide || dp < 0 || st.drawn[r]! & 3) continue;
          (byDepth.get(dp) ?? byDepth.set(dp, []).get(dp)!).push(v);
        }
        for (const [dp, ids] of [...byDepth].sort((a, b) => a[0] - b[0])) emit(st, hooks, side, dp, ids);
      }
      return { distance: Lf + Lb, pathCount, explored: st.n, dag, featured: featuredRoute(dag, s, t), sampled };
    }
  }
}

function emit(st: SearchState, hooks: SearchHooks, side: Side, depth: number, ids: number[]) {
  if (!ids.length) return;
  const out = Int32Array.from(ids);
  const angles = new Float32Array(ids.length);
  const parents = new Float32Array(ids.length);
  ids.forEach((v, i) => {
    const r = st.find(v);
    st.drawn[r]! |= 1 << side;
    angles[i] = st.ang[side][r]!;
    const p = st.par[side][r]!;
    parents[i] = p < 0 ? 0 : st.ang[side][st.find(p)]!;
  });
  hooks.onNodes(side, depth, out, angles, parents);
}

// Walk back from the meeting articles level by level on each side, re-reading lists
// from the search cache and keeping edges into the current set.
async function recoverDag(st: SearchState, levels: [Int32Array[], Int32Array[]], meet: number[], hooks: SearchHooks): Promise<Dag> {
  const Lf = levels[0].length - 1, Lb = levels[1].length - 1;
  const index = new Map<number, number>();
  const ids: number[] = [], pos: number[] = [], fromS: number[] = [], toT: number[] = [];
  const edges: number[] = [];
  const add = (v: number, p: number, f: number, b: number) => {
    index.set(v, ids.length);
    ids.push(v);
    pos.push(p);
    fromS.push(f);
    toT.push(b);
  };
  for (const v of meet) {
    const r = st.find(v);
    add(v, Lf, st.cnt[0][r]!, st.cnt[1][r]!);
  }
  // forward: u at depth j links to v at depth j + 1 in the DAG; toT(u) = Σ toT(v)
  let cur = new Set(meet);
  for (let j = Lf - 1; j >= 0; j--) {
    const keep = new Set<number>();
    await forLists(
      hooks.reader,
      0,
      levels[0][j]!,
      (u, list) => {
        let sum = 0;
        const to: number[] = [];
        for (const v of list) if (cur.has(v)) { sum += toT[index.get(v)!]!; to.push(index.get(v)!); }
        if (!sum) return;
        keep.add(u);
        add(u, j, st.cnt[0][st.find(u)]!, sum);
        const iu = index.get(u)!;
        for (const iv of to) edges.push(iu, iv);
      },
      hooks.ctx,
    );
    cur = keep;
  }
  // backward: w at depth j (from the finish) is reached from v at depth j + 1; fromS(w) = Σ fromS(v)
  cur = new Set(meet);
  for (let j = Lb - 1; j >= 0; j--) {
    const keep = new Set<number>();
    await forLists(
      hooks.reader,
      1,
      levels[1][j]!,
      (w, list) => {
        let sum = 0;
        const from: number[] = [];
        for (const v of list) if (cur.has(v)) { sum += fromS[index.get(v)!]!; from.push(index.get(v)!); }
        if (!sum) return;
        keep.add(w);
        add(w, Lf + (Lb - j), sum, st.cnt[1][st.find(w)]!);
        const iw = index.get(w)!;
        for (const iv of from) edges.push(iv, iw);
      },
      hooks.ctx,
    );
    cur = keep;
  }
  return {
    ids: Int32Array.from(ids),
    meeting: Int32Array.from(meet),
    pos: Uint8Array.from(pos),
    through: Float64Array.from(ids, (_, i) => fromS[i]! * toT[i]!),
    edges: Int32Array.from(edges),
  };
}

// The featured route: from the start, step to the DAG successor through which
// the most shortest routes pass; ties go to the lower map id.
export function featuredRoute(dag: Dag, s: number, t: number): number[] {
  const succ = new Map<number, number[]>();
  for (let e = 0; e < dag.edges.length; e += 2) {
    const a = dag.edges[e]!;
    (succ.get(a) ?? succ.set(a, []).get(a)!).push(dag.edges[e + 1]!);
  }
  let i = Array.prototype.indexOf.call(dag.ids, s) as number;
  const route = [s];
  while (dag.ids[i] !== t) {
    let best = -1;
    for (const j of succ.get(i) ?? []) {
      if (best < 0 || dag.through[j]! > dag.through[best]! || (dag.through[j] === dag.through[best] && dag.ids[j]! < dag.ids[best]!)) best = j;
    }
    if (best < 0) throw new Error('featured route: dead end in the DAG');
    route.push(dag.ids[best]!);
    i = best;
  }
  return route;
}

// The hop check: for each route of map ids (null where a title isn't in the map), the
// indexes i of hops route[i] → route[i + 1] that aren't links in the map.
export async function checkRoutes(reader: MapReader, routes: (number | null)[][], ctx: ReadContext): Promise<number[][]> {
  const sources = new Set<number>();
  for (const r of routes) for (let i = 0; i + 1 < r.length; i++) if (r[i] != null) sources.add(r[i]!);
  const lists = new Map<number, Int32Array>();
  await forLists(reader, 0, sortedIds([...sources]), (u, list) => lists.set(u, list), ctx);
  const has = (list: Int32Array, v: number) => {
    let lo = 0, hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (list[mid] === v) return true;
      if (list[mid]! < v) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };
  return routes.map((r) => {
    const missing: number[] = [];
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i], b = r[i + 1];
      if (a == null || b == null || !has(lists.get(a)!, b)) missing.push(i);
    }
    return missing;
  });
}
