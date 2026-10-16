// Step 6 of the map pipeline: the browser's own search, run in Node against the live data sites,
// before the site goes live with the new map.
//
//   node pipeline/check-live.mjs
//
// map.json and the index files come from public/ on disk (the site doesn't serve them yet); the
// chunk files come from the data sites, as publish.mjs left them. Every classic course, the next
// daily courses and a few pool pairs per level are looked up and searched, and each distance and
// route count must equal the d and k the pipeline wrote for it. Exit 1 on any mismatch.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../src/search/worker.ts';

const DAILY = 3;
const PER_LEVEL = 3;
const LOCAL = 'http://site.local/';
// GitHub Pages answers 429 to one client reading this fast for long (about ten searches in 30 s
// at the browser's 32 lanes), so the check reads gently and pauses between courses
const LANES = 6;
const PAUSE_MS = 4000;
const RETRY_MS = 60_000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const read = (f) => JSON.parse(readFileSync(join(pub, f), 'utf8'));
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...a);

// public/ stands in for the site; everything else (the data sites) goes to the network
async function siteFetch(input, init) {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(LOCAL)) return fetch(input, init);
  try {
    return new Response(readFileSync(join(pub, new URL(url).pathname)), { status: 200 });
  } catch {
    return new Response('', { status: 404 });
  }
}

const messages = [];
const host = createHost((m) => messages.push(m), { base: LOCAL, fetch: siteFetch, cacheApi: false, lanes: LANES, backoff: [5000, 20000] });
const ask = async (m, kind) => {
  const from = messages.length;
  await host.handle(m);
  return messages.slice(from).find((x) => x.kind === kind || x.kind === 'error' || x.kind === 'requestError');
};

const today = new Date().toISOString().slice(0, 10);
const pools = read('pools.json');
const courses = [
  ...read('classics.json').courses.map((c) => ({ ...c, from: 'classic' })),
  ...read('daily.json').days.filter((x) => x.date >= today).slice(0, DAILY).map((c) => ({ ...c, from: `daily ${c.date}` })),
  ...['easy', 'medium', 'hard'].flatMap((l) => pools[l].slice(0, PER_LEVEL).map((c) => ({ ...c, from: l }))),
];

const map = read('map.json');
log(`map ${map.version}: ${courses.length} courses against ${map.sites.length} data sites`);
// One course: { ok, retry (a network error, worth another go), line }
async function check(c) {
  const name = `${c.from}: ${c.start} → ${c.finish}`;
  const look = await ask({ kind: 'lookup', reqId: ++id, titles: [c.start, c.finish] }, 'lookupResult');
  if (look?.kind !== 'lookupResult' || look.results.some((r) => !r)) {
    const why = look?.kind === 'lookupResult' ? 'title not in the map' : look?.reason ?? 'no answer';
    return { ok: false, retry: why === 'network', line: `FAIL ${name}: ${why}` };
  }
  const [s, t] = look.results.map((r) => r.id);
  const done = await ask({ kind: 'search', searchId: ++id, from: s, to: t, drawBudget: 5000, budgetBytes: 64 * 1024 * 1024 }, 'done');
  if (done?.kind !== 'done') return { ok: false, retry: done?.reason === 'network', line: `FAIL ${name}: ${done?.reason ?? 'no answer'}` };
  const ok = done.distance === c.d && done.pathCount === c.k;
  return { ok, retry: false, line: `${ok ? 'ok  ' : 'FAIL'} ${name}: ${done.distance} clicks, ${done.pathCount} routes (want ${c.d}, ${c.k}), ${(done.fetchedBytes / 1024).toFixed(0)} KB` };
}

let bad = 0;
let id = 0;
for (const c of courses) {
  if (id) await new Promise((r) => setTimeout(r, PAUSE_MS));
  let r = await check(c);
  if (r.retry) {
    log(`${r.line}; trying again in a minute`);
    await new Promise((res) => setTimeout(res, RETRY_MS));
    r = await check(c);
  }
  if (!r.ok) bad++;
  log(r.line);
}
log(bad ? `${bad} of ${courses.length} courses failed` : `all ${courses.length} courses match`);
process.exit(bad ? 1 : 0);
