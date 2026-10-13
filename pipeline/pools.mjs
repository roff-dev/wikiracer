// Step 4 of the map pipeline: course pools, difficulty labels, the daily
// schedule, classic courses and the home page's demo replay.
//
//   node --max-old-space-size=12000 pipeline/pools.mjs [--graph <dir>] [--launch YYYY-MM-DD] [--pairs 30000]
//
// --graph defaults to the newest finished pipeline/work/graph-<run>/. --launch is needed only
// when public/daily.json doesn't exist yet; after that the file's own launch date is kept.
// Writes public/pools.json, public/daily.json (append-only), public/classics.json and
// public/demo.json, and prints the label split.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { makeSearch } from './lib/bfs.mjs';
import { addDays, assertAppendOnly, extendDaily } from './lib/daily.mjs';
import { loadGraph, newestWorkDir } from './lib/graph.mjs';
import { START_THRESHOLDS, isPoolTitle, labelOf, rng, split, tuneThresholds } from './lib/pools.mjs';
import { bfsRank } from './lib/renumber.mjs';
import { childAngle, drawCount, isDrawn } from '../src/search/bfs.ts';

const POOL_SIZE = 100_000; // top articles by in-degree, before the title filters
const FINISH_SIZE = 30_000; // finishes come from the pool's top 30,000
const PER_LABEL = 1_000; // pairs per label in pools.json
const DAILY_AHEAD = 400; // days
const DEMO_BUDGET = 2_000; // drawn nodes in the demo replay
const DEMO_TOP = 10_000; // the demo's articles come from the top 10,000 by in-degree, so they're recognisable
const CLASSICS = [
  ['Kevin_Bacon', 'Banana'],
  ['Pizza', 'Moon'],
  ['William_Shakespeare', 'Mount_Everest'],
  ['Chocolate', 'Black_hole'],
];

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const graphDir = opt('--graph') ?? newestWorkDir(join(root, 'pipeline', 'work'), 'graph');
const PAIRS = Number(opt('--pairs') ?? 30_000);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...a);

const g = loadGraph(graphDir);
const { N, inOff } = g;
const run = g.meta.dump;
const rank = bfsRank(g);
const title = (i) => g.titles.toString('utf8', g.titleOff[i], g.titleOff[i + 1]);
log(`graph ${run}: N ${N}`);

const byIn = Int32Array.from({ length: N }, (_, i) => i).sort((a, b) => (inOff[b + 1] - inOff[b]) - (inOff[a + 1] - inOff[a]) || a - b);
const pool = [];
let dropped = 0;
for (let r = 0; r < POOL_SIZE; r++) {
  const i = byIn[r];
  if (isPoolTitle(title(i), (g.flags[i] & 1) === 1)) pool.push(i);
  else dropped++;
}
const finishes = pool.slice(0, FINISH_SIZE);
const inRank = new Int32Array(N);
byIn.forEach((i, r) => { inRank[i] = r; });
log(`pool: ${pool.length} articles (${dropped} of the top ${POOL_SIZE} filtered out), finishes ${finishes.length}`);

// title → graph id for the titles the script names
const named = new Set(CLASSICS.flat());
const idOf = new Map();
for (let i = 0; i < N && idOf.size < named.size; i++) { const t = title(i); if (named.has(t)) idOf.set(t, i); }
for (const t of named) if (!idOf.has(t)) throw new Error(`classic title not in the map: ${t}`);

const bfs = makeSearch(g);
const classicKeys = new Set(CLASSICS.map(([a, b]) => `${idOf.get(a)}>${idOf.get(b)}`));
const classics = CLASSICS.map(([a, b]) => {
  const r = bfs.search(idOf.get(a), idOf.get(b));
  return { start: a, finish: b, d: r.d, k: r.k };
});
log('classics', classics.map((c) => `${c.start} → ${c.finish}: ${c.d} (${c.k})`).join('; '));

const rand = rng(Number(run));
const seen = new Set(classicKeys);
const pairs = [];
let trivial = 0, unreachable = 0;
const times = [];
while (pairs.length + trivial + unreachable < PAIRS) {
  const s = pool[Math.floor(rand() * pool.length)];
  const t = finishes[Math.floor(rand() * finishes.length)];
  const key = `${s}>${t}`;
  if (s === t || seen.has(key)) continue;
  seen.add(key);
  const t1 = performance.now();
  const r = bfs.search(s, t);
  times.push(performance.now() - t1);
  if (r.d === Infinity) { unreachable++; continue; }
  if (r.d <= 1) { trivial++; continue; }
  pairs.push({ s, t, d: r.d, k: r.k });
  if (pairs.length % 5000 === 0) log(`measured ${pairs.length}`);
}
times.sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
log(`measured ${PAIRS} pairs: ${pairs.length} kept, ${trivial} direct links (d = 1) dropped, ${unreachable} unreachable; BFS p50/p90 ${q(times, 0.5).toFixed(1)} / ${q(times, 0.9).toFixed(1)} ms`);

const hist = {};
for (const p of pairs) hist[p.d] = (hist[p.d] ?? 0) + 1;
console.log('distance:', Object.entries(hist).map(([d, n]) => `${d}: ${n} (${((100 * n) / pairs.length).toFixed(1)}%)`).join(', '));
for (const d of Object.keys(hist).map(Number)) {
  const ks = pairs.filter((p) => p.d === d).map((p) => p.k).sort((a, b) => a - b);
  console.log(`  d = ${d}: k p10/p25/p50/p75/p90 ${[0.1, 0.25, 0.5, 0.75, 0.9].map((x) => q(ks, x)).join(' / ')}`);
}
const pct = (s) => Object.entries(s).map(([l, n]) => `${l} ${((100 * n) / pairs.length).toFixed(1)}%`).join(', ');
console.log(`split with the starting thresholds ${JSON.stringify(START_THRESHOLDS)}: ${pct(split(pairs, START_THRESHOLDS))}`);
const TH = tuneThresholds(pairs);
console.log(`tuned thresholds ${JSON.stringify(TH)}: ${pct(split(pairs, TH))}`);

const byLabel = { easy: [], medium: [], hard: [] };
for (const p of pairs) byLabel[labelOf(p.d, p.k, TH)].push({ ...p, start: title(p.s), finish: title(p.t) });
for (const [l, list] of Object.entries(byLabel)) if (list.length < PER_LABEL + (l === 'easy' ? 0 : DAILY_AHEAD)) throw new Error(`only ${list.length} ${l} pairs`);
const strip = ({ start, finish, d, k }) => ({ start, finish, d, k });
const pools = {
  version: run,
  thresholds: TH,
  easy: byLabel.easy.slice(0, PER_LABEL).map(strip),
  medium: byLabel.medium.slice(0, PER_LABEL).map(strip),
  hard: byLabel.hard.slice(0, PER_LABEL).map(strip),
};

// Daily schedule (append-only), from pairs not in pools.json
const dailyPath = join(pub, 'daily.json');
const before = existsSync(dailyPath) ? JSON.parse(readFileSync(dailyPath, 'utf8')) : null;
const launch = before?.launch ?? opt('--launch');
if (!launch) throw new Error('public/daily.json is new: pass --launch YYYY-MM-DD');
const today = new Date().toISOString().slice(0, 10);
const until = addDays(today > launch ? today : launch, DAILY_AHEAD - 1);
const rest = { medium: byLabel.medium.slice(PER_LABEL).map(strip), hard: byLabel.hard.slice(PER_LABEL).map(strip) };
const daily = extendDaily(before ?? { launch, days: [] }, rest, until);
if (before) assertAppendOnly(before, daily);
const dailyUsed = new Set(daily.days.map((x) => `${x.start}>${x.finish}`));
// Days already published name titles from an older map; a title missing now still resolves
// through Wikipedia's redirects, so this only warns.
let stale = 0;
if (before) {
  const want = new Set(before.days.flatMap((x) => [x.start, x.finish]));
  const found = new Set();
  for (let i = 0; i < N; i++) { const t = title(i); if (want.has(t)) found.add(t); }
  stale = before.days.filter((x) => !found.has(x.start) || !found.has(x.finish)).length;
}
log(`daily: ${before ? before.days.length : 0} existing days kept, ${daily.days.length - (before?.days.length ?? 0)} added, through ${daily.days.at(-1).date}${stale ? `; ${stale} existing days name a title that's no longer in the map (check them)` : ''}`);

// Demo replay: a pair in no pool, daily or classic list
const inPools = new Set(Object.values(byLabel).flatMap((l) => l.slice(0, PER_LABEL)).map((p) => `${p.start}>${p.finish}`));
function record(s, t) {
  const res = bfs.search(s, t);
  const dagNodes = bfs.dag(res, s, t);
  const route = bfs.featured(dagNodes, s, t, rank);
  const angle = new Map([[s, 0], [t, 0]]);
  // flags: bit 0 on a shortest route (DAG), bit 1 a meeting article
  const meet = new Set(res.meet);
  const flag = (v) => (dagNodes.has(v) ? 1 : 0) | (meet.has(v) ? 2 : 0);
  const out = { id: [rank[s], rank[t]], side: [0, 1], depth: [0, 0], angle: [0, 0], parentAngle: [0, 0], flags: [flag(s), flag(t)] };
  let remaining = DEMO_BUDGET - 2;
  res.levels.forEach((lvl, i) => {
    const met = i === res.levels.length - 1;
    const n = lvl.nodes.length;
    const k = drawCount(n, remaining, met);
    let drawn = 0;
    for (const v of lvl.nodes) {
      const pa = angle.get(bfs.par[lvl.side][v]);
      const a = childAngle(rank[v], lvl.depth, pa);
      angle.set(v, a);
      if (!dagNodes.has(v) && !isDrawn(rank[v], k, n)) continue;
      out.id.push(rank[v]); out.side.push(lvl.side); out.depth.push(lvl.depth); out.angle.push(a); out.parentAngle.push(pa); out.flags.push(flag(v));
      drawn++;
    }
    remaining = Math.max(0, remaining - drawn);
  });
  return { res, route, out, dagSize: dagNodes.size };
}
let demo = null;
for (const p of byLabel.medium) {
  const key = `${p.start}>${p.finish}`;
  if (p.d !== 3 || p.k < 5 || p.k > 40 || inPools.has(key) || dailyUsed.has(key)) continue;
  if (inRank[p.s] >= DEMO_TOP || inRank[p.t] >= DEMO_TOP) continue;
  const r = record(p.s, p.t);
  if (r.res.explored < 20_000 || r.out.side.length > DEMO_BUDGET) continue;
  const b64 = (T, a) => Buffer.from(T.from(a).buffer).toString('base64');
  demo = {
    version: run,
    start: p.start,
    finish: p.finish,
    d: p.d,
    k: p.k,
    explored: r.res.explored,
    route: r.route.map(title),
    // map ids of the route's stops, so the replay can place them
    routeIds: r.route.map((v) => rank[v]),
    nodes: {
      count: r.out.side.length,
      id: b64(Int32Array, r.out.id),
      flags: b64(Uint8Array, r.out.flags),
      side: b64(Uint8Array, r.out.side),
      depth: b64(Uint8Array, r.out.depth),
      angle: b64(Float32Array, r.out.angle),
      parentAngle: b64(Float32Array, r.out.parentAngle),
    },
  };
  break;
}
if (!demo) throw new Error('no demo pair found');
log(`demo: ${demo.start} → ${demo.finish}, d ${demo.d}, k ${demo.k}, explored ${demo.explored}, drawn ${demo.nodes.count}, route ${demo.route.join(' > ')}`);

const write = (name, obj) => {
  const text = JSON.stringify(obj) + '\n';
  writeFileSync(join(pub, name), text);
  return { raw: text.length, gzip: gzipSync(text, { level: 9 }).length };
};
const sizes = {
  'pools.json': write('pools.json', pools),
  'daily.json': write('daily.json', daily),
  'classics.json': write('classics.json', { version: run, courses: classics }),
  'demo.json': write('demo.json', demo),
};
for (const [n, s] of Object.entries(sizes)) console.log(`${n}: ${s.raw} B, gzip ${s.gzip} B`);
const home = sizes['daily.json'].gzip + sizes['demo.json'].gzip;
console.log(`home data (daily + demo, gzip): ${home} B of the 60 KB budget`);
log('done');
