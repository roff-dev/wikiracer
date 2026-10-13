// Step 2 of the map pipeline (spec §5.7, §9 S2): the English Wikipedia article link graph from
// the SQL dumps, written as CSR arrays.
//
//   node --max-old-space-size=14000 pipeline/graph.mjs [--dumps <dir>] [--out <dir>]
//
// --dumps defaults to the newest pipeline/work/dumps-<run>/ that download.mjs verified (it reads
// run.json); --out defaults to pipeline/work/graph-<run>/. About 13.5 minutes and ~8 GB RAM.
//
// Nodes: non-redirect namespace-0 pages. Edges: pagelinks from an article to an existing article,
// with links to redirects resolved to their target (link rule R1, spec §3.4). Deduplicated, no
// self-links.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E, S, forEachRow, int, skip, str, unescapeInto } from './lib/sql.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const work = join(dirname(fileURLToPath(import.meta.url)), 'work');
const dumpDir = opt('--dumps') ?? (() => {
  const runs = existsSync(work) ? readdirSync(work).filter((d) => /^dumps-\d{8}$/.test(d)).sort() : [];
  if (!runs.length) throw new Error('No pipeline/work/dumps-<run>/; run download.mjs or pass --dumps');
  return join(work, runs.at(-1));
})();
const runPath = join(dumpDir, 'run.json');
if (!existsSync(runPath)) throw new Error(`${runPath} missing; run download.mjs first`);
const run = JSON.parse(readFileSync(runPath, 'utf8')).run;
const outDir = opt('--out') ?? join(work, `graph-${run}`);
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'meta.json'), { force: true });
const dump = (t) => join(dumpDir, `enwiki-${run}-${t}.sql.gz`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const t0 = Date.now();

// 64-bit title hash over the raw (escaped) bytes; every dump escapes titles the same way.
let H1 = 0, H2 = 0;
function hash(b, s, e) {
  let h1 = 0x811c9dc5, h2 = (0x9747b28c ^ (e - s)) | 0;
  for (let i = s; i < e; i++) {
    const c = b[i];
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  H1 = h1 >>> 0; H2 = h2 >>> 0;
}
// Title hash → page id, open addressing. 2^25 slots for 19.3M ns0 pages (20261001).
const CAP = 1 << 25, MASK = CAP - 1;
const tH1 = new Uint32Array(CAP), tH2 = new Uint32Array(CAP), tVal = new Int32Array(CAP).fill(-1);
let tUsed = 0;
function put(v) {
  if (++tUsed > CAP * 0.85) throw new Error('title table over 85% full; raise CAP');
  let i = H1 & MASK;
  while (tVal[i] !== -1) { if (tH1[i] === H1 && tH2[i] === H2) throw new Error('dup/collision ' + v); i = (i + 1) & MASK; }
  tH1[i] = H1; tH2[i] = H2; tVal[i] = v;
}
function get() {
  let i = H1 & MASK;
  while (tVal[i] !== -1) { if (tH1[i] === H1 && tH2[i] === H2) return tVal[i]; i = (i + 1) & MASK; }
  return -1;
}

// Caps with headroom over 20261001 (max page id ~84.5M, max linktarget id ~132.1M, N 7.25M).
// Typed arrays drop out-of-range writes silently, so every id is checked against its cap.
const MAX_PAGE = 90_000_000, MAX_LT = 140_000_000, MAX_N = 9_000_000, MAX_TITLE_BYTES = 400_000_000;
const cap = (v, max, what) => { if (v >= max) throw new Error(`${what} ${v} over cap ${max}; raise it`); return v; };
const isRedir = new Uint8Array(MAX_PAGE);
const denseOf = new Int32Array(MAX_PAGE).fill(-1);
const redirTo = new Int32Array(MAX_PAGE).fill(-1);
const pageIdArr = new Int32Array(MAX_N);
const pageLenArr = new Int32Array(MAX_N);
const titleBuf = Buffer.allocUnsafe(MAX_TITLE_BYTES);
const titleOffArr = new Uint32Array(MAX_N + 1);
let titleBytes = 0;
let N = 0;
let ns0Pages = 0;

log(`run ${run}: page`);
let bytes = await forEachRow(dump('page'), (b) => {
  const id = cap(int(b), MAX_PAGE, 'page id');
  const ns = int(b);
  if (ns !== 0) return;
  str(b);
  const s = S, e = E;
  const redirect = int(b);
  skip(b); skip(b); skip(b); skip(b); skip(b);
  const len = int(b);
  hash(b, s, e);
  put(id);
  ns0Pages++;
  if (redirect) { isRedir[id] = 1; return; }
  cap(N, MAX_N, 'article count');
  cap(titleBytes + (e - s), MAX_TITLE_BYTES, 'title bytes');
  denseOf[id] = N;
  pageIdArr[N] = id;
  pageLenArr[N] = len;
  titleBytes = unescapeInto(titleBuf, titleBytes, b, s, e);
  titleOffArr[++N] = titleBytes;
});
log(`page: ${(bytes / 1e9).toFixed(1)} GB raw, ns0 pages ${ns0Pages}, articles ${N}`);

log('redirect');
let rdRows = 0, rdResolved = 0;
await forEachRow(dump('redirect'), (b) => {
  const from = cap(int(b), MAX_PAGE, 'redirect page id');
  const ns = int(b);
  if (ns !== 0) return;
  str(b);
  const s = S, e = E;
  const hasIw = str(b) && E > S;
  rdRows++;
  if (hasIw) return;
  hash(b, s, e);
  const to = get();
  if (to >= 0) { redirTo[from] = to; rdResolved++; }
});
log(`redirect: ${rdRows} ns0 rows, ${rdResolved} resolve to an existing page`);

// Follows up to 6 redirect hops to an article's dense id, or -1 (loop, chain too long, missing).
function resolve(pid) {
  for (let k = 0; k < 6 && pid >= 0; k++) {
    if (!isRedir[pid]) return denseOf[pid];
    pid = redirTo[pid];
  }
  return -1;
}

log('page_props');
const flags = new Uint8Array(N); // bit 0: disambiguation page
let disambig = 0;
const DIS = Buffer.from('disambiguation');
await forEachRow(dump('page_props'), (b) => {
  const pid = int(b);
  str(b);
  if (E - S === DIS.length && b.compare(DIS, 0, DIS.length, S, E) === 0) {
    const d = pid < MAX_PAGE ? denseOf[pid] : -1;
    if (d >= 0) { flags[d] |= 1; disambig++; }
  }
});
log(`disambiguation articles: ${disambig}`);

log('linktarget');
const ltDense = new Int32Array(MAX_LT).fill(-1);
const ltViaRedirect = new Uint8Array(MAX_LT);
let lt0 = 0, ltArticle = 0, ltRedirect = 0, ltMissing = 0;
await forEachRow(dump('linktarget'), (b) => {
  const id = cap(int(b), MAX_LT, 'linktarget id');
  const ns = int(b);
  if (ns !== 0) return;
  lt0++;
  str(b);
  hash(b, S, E);
  const pid = get();
  if (pid < 0) { ltMissing++; return; }
  const d = resolve(pid);
  if (d < 0) { ltMissing++; return; }
  ltDense[id] = d;
  if (isRedir[pid]) { ltViaRedirect[id] = 1; ltRedirect++; } else ltArticle++;
});
log(`linktarget ns0: ${lt0}; to articles ${ltArticle}, via redirects ${ltRedirect}, red/unresolved ${ltMissing}`);

// pagelinks rows are (pl_from, pl_from_namespace, pl_target_id). Two passes: count, then fill.
const outCount = new Uint32Array(N + 1);
const c = { rows: 0, fromNs0: 0, fromArticle: 0, toArticle: 0, viaRedirect: 0, self: 0 };
log('pagelinks pass 1');
bytes = await forEachRow(dump('pagelinks'), (b) => {
  c.rows++;
  const from = int(b);
  const fromNs = int(b);
  if (fromNs !== 0) return;
  c.fromNs0++;
  const s = from < MAX_PAGE ? denseOf[from] : -1;
  if (s < 0) return;
  c.fromArticle++;
  const t = int(b);
  const d = t < MAX_LT ? ltDense[t] : -1;
  if (d < 0) return;
  if (d === s) { c.self++; return; }
  c.toArticle++;
  if (ltViaRedirect[t]) c.viaRedirect++;
  outCount[s]++;
});
log(`pagelinks: ${(bytes / 1e9).toFixed(1)} GB raw`, c);

const off = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) off[i + 1] = off[i] + outCount[i];
if (off[N] !== c.toArticle) throw new Error(`edge count overflow: ${off[N]} vs ${c.toArticle}`);
const raw = new Int32Array(off[N]);
const fill = off.slice(0, N);
log('pagelinks pass 2', off[N]);
await forEachRow(dump('pagelinks'), (b) => {
  const from = int(b);
  if (int(b) !== 0) return;
  const s = from < MAX_PAGE ? denseOf[from] : -1;
  if (s < 0) return;
  const t = int(b);
  const d = t < MAX_LT ? ltDense[t] : -1;
  if (d < 0 || d === s) return;
  raw[fill[s]++] = d;
});
for (let i = 0; i < N; i++) if (fill[i] !== off[i + 1]) throw new Error(`pagelinks changed between passes at ${i}`);

log('sort + dedupe');
const outOff = new Uint32Array(N + 1);
let w = 0;
for (let i = 0; i < N; i++) {
  const list = raw.subarray(off[i], off[i + 1]);
  list.sort();
  outOff[i] = w;
  let prev = -1;
  for (let k = 0; k < list.length; k++) { const v = list[k]; if (v !== prev) { raw[w++] = v; prev = v; } }
}
outOff[N] = w;
const out = raw.subarray(0, w);
log(`edges after dedupe: ${w} (dupes from redirect merging: ${off[N] - w})`);

const inCount = new Uint32Array(N);
for (let k = 0; k < w; k++) inCount[out[k]]++;
const inOff = new Uint32Array(N + 1);
for (let i = 0; i < N; i++) inOff[i + 1] = inOff[i] + inCount[i];
const inAdj = new Int32Array(w);
const ifill = inOff.slice(0, N);
for (let i = 0; i < N; i++) for (let k = outOff[i]; k < outOff[i + 1]; k++) inAdj[ifill[out[k]]++] = i;

let deadEnds = 0, orphans = 0;
for (let i = 0; i < N; i++) { if (outOff[i + 1] === outOff[i]) deadEnds++; if (inOff[i + 1] === inOff[i]) orphans++; }

log('write');
const wr = (name, arr) => {
  const fd = openSync(join(outDir, name), 'w');
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let o = 0; o < buf.length; o += 1 << 28) writeSync(fd, buf, o, Math.min(1 << 28, buf.length - o));
  closeSync(fd);
};
wr('out.off', outOff); wr('out.adj', out); wr('in.off', inOff); wr('in.adj', inAdj);
wr('pageid.bin', pageIdArr.subarray(0, N)); wr('len.bin', pageLenArr.subarray(0, N)); wr('flags.bin', flags);
writeFileSync(join(outDir, 'titles.bin'), titleBuf.subarray(0, titleBytes));
wr('titles.off', titleOffArr.subarray(0, N + 1));
const meta = { dump: run, N, E: w, ns0Pages, rdRows, rdResolved, disambig, lt0, ltArticle, ltRedirect, ltMissing, pagelinks: c, dupes: off[N] - w, deadEnds, orphans };
// meta.json is written last: its presence marks a finished build.
writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min: N ${N}, E ${w}, dead ends ${deadEnds}, orphans ${orphans}`);
