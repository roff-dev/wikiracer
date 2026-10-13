// Step 1 of the map pipeline (spec §5.7, §8.1): fetch the five SQL dumps for the newest
// complete monthly run from the mirror and check each against the official md5sums file.
//
//   node pipeline/download.mjs [--run YYYYMMDD] [--out <dir>]
//
// Default out is pipeline/work/dumps-<run>/. Files already there are hashed, not re-fetched;
// a verified file is recorded in run.json (with size and mtime) so later runs skip the hash.
// Exit 2 means no complete run was found: the current map stays live.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const OFFICIAL = 'https://dumps.wikimedia.org/enwiki';
const MIRROR = 'https://mirror.accum.se/mirror/wikimedia.org/dumps/enwiki';
// dumpstatus.json job → file suffix
const TABLES = {
  pagetable: 'page',
  pagelinkstable: 'pagelinks',
  linktargettable: 'linktarget',
  redirecttable: 'redirect',
  pagepropstable: 'page_props',
};

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Monthly runs are dated the 1st; the 20th runs are skipped.
async function findRun() {
  const listing = await getText(`${OFFICIAL}/`);
  const runs = [...listing.matchAll(/href="(\d{6}01)\/"/g)].map((m) => m[1]).sort().reverse();
  for (const run of runs.slice(0, 3)) {
    if (await runFiles(run)) return run;
    console.log(`${run}: tables not finished, trying the previous run`);
  }
  return null;
}

// The five files with their sizes, or null if any table job isn't done.
async function runFiles(run) {
  const status = JSON.parse(await getText(`${OFFICIAL}/${run}/dumpstatus.json`));
  const files = [];
  for (const [job, table] of Object.entries(TABLES)) {
    const j = status.jobs[job];
    const name = `enwiki-${run}-${table}.sql.gz`;
    if (j?.status !== 'done' || !j.files?.[name]) return null;
    files.push({ name, size: j.files[name].size });
  }
  return files;
}

async function md5sums(run) {
  const text = await getText(`${OFFICIAL}/${run}/enwiki-${run}-md5sums.txt`);
  return new Map(text.trim().split('\n').map((l) => { const [md5, name] = l.trim().split(/\s+/); return [name, md5]; }));
}

async function md5File(path) {
  const hash = createHash('md5');
  await pipeline(createReadStream(path, { highWaterMark: 1 << 22 }), hash);
  return hash.digest('hex');
}

// Fetch to <name>.part, resuming with a Range request if a partial file is there.
async function fetchFile(run, file, path) {
  const part = `${path}.part`;
  for (const base of [MIRROR, OFFICIAL]) {
    const have = existsSync(part) ? statSync(part).size : 0;
    if (have === file.size) break;
    const url = `${base}/${run}/${file.name}`;
    const res = await fetch(url, have ? { headers: { Range: `bytes=${have}-` } } : {});
    if (!(res.ok && (have ? res.status === 206 : res.status === 200))) {
      console.log(`  ${res.status} from ${base === MIRROR ? 'mirror' : 'dumps.wikimedia.org'}`);
      await res.body?.cancel();
      continue;
    }
    const t0 = Date.now();
    let got = 0, lastLog = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (c) => {
      got += c.length;
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        const mbps = got / 1e6 / ((Date.now() - t0) / 1000);
        console.log(`  ${(((have + got) / file.size) * 100).toFixed(1)}% at ${mbps.toFixed(1)} MB/s`);
      }
    });
    try {
      await pipeline(body, createWriteStream(part, { flags: have ? 'a' : 'w' }));
    } catch (e) {
      console.log(`  interrupted (${e.message}); retrying`);
    }
    if (statSync(part).size === file.size) break;
  }
  if (!existsSync(part) || statSync(part).size !== file.size) throw new Error(`${file.name}: download incomplete`);
  renameSync(part, path);
}

const run = opt('--run') ?? (await findRun());
if (!run) {
  console.log('No complete monthly run found. The current map stays live.');
  process.exit(2);
}
const files = await runFiles(run);
if (!files) {
  console.log(`${run}: tables not finished. The current map stays live.`);
  process.exit(2);
}
const sums = await md5sums(run);
const out = opt('--out') ?? join(dirname(fileURLToPath(import.meta.url)), 'work', `dumps-${run}`);
mkdirSync(out, { recursive: true });
const recordPath = join(out, 'run.json');
const prev = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : { files: [] };
const record = { run, files: [] };

console.log(`Run ${run} → ${out}`);
for (const file of files) {
  const path = join(out, file.name);
  const md5 = sums.get(file.name);
  if (!md5) throw new Error(`${file.name}: not in md5sums`);
  const seen = prev.files.find((f) => f.name === file.name);
  const st = existsSync(path) ? statSync(path) : null;
  if (st && seen && seen.md5 === md5 && seen.size === st.size && seen.mtimeMs === st.mtimeMs) {
    console.log(`${file.name}: verified earlier`);
    record.files.push(seen);
    continue;
  }
  if (!st || st.size !== file.size) {
    console.log(`${file.name}: fetching ${(file.size / 1e9).toFixed(2)} GB`);
    await fetchFile(run, file, path);
  }
  const t0 = Date.now();
  const got = await md5File(path);
  if (got !== md5) {
    renameSync(path, `${path}.bad`);
    throw new Error(`${file.name}: md5 ${got}, expected ${md5} (moved to .bad)`);
  }
  console.log(`${file.name}: md5 OK (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  record.files.push({ name: file.name, size: file.size, md5, mtimeMs: statSync(path).mtimeMs });
  writeFileSync(recordPath, JSON.stringify(record, null, 2));
}
writeFileSync(recordPath, JSON.stringify(record, null, 2));
const total = record.files.reduce((s, f) => s + f.size, 0);
console.log(`All ${record.files.length} files verified, ${(total / 1e9).toFixed(2)} GB.`);
