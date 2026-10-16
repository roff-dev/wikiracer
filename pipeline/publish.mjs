// Step 5 of the map pipeline: pushes the chunk files to the four data sites (GitHub Pages).
//
//   node pipeline/publish.mjs [--map <dir>] [--dry-run] [--probe-only]
//
// --map defaults to the newest finished pipeline/work/map-<run>/ and must match public/map.json.
// Each data repo is rebuilt as a single fresh commit in pipeline/work/publish/<repo>/ and
// force-pushed to main, so an old version leaves the repo's history instead of piling up in it.
// --dry-run builds and audits the repos without pushing; --probe-only skips straight to waiting
// for the sites. After the push it waits until every chunk answers a 1-byte Range request.
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestWorkDir } from './lib/graph.mjs';
import { OWNER, SITES } from './lib/sites.mjs';

const PROBE_EVERY = 20_000;
const PROBE_LIMIT = 20 * 60_000;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'pipeline', 'work');
const mapDir = opt('--map') ?? newestWorkDir(work, 'map');
const dryRun = args.includes('--dry-run');
const probeOnly = args.includes('--probe-only');
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...a);

const map = JSON.parse(readFileSync(join(root, 'public', 'map.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(mapDir, 'meta.json'), 'utf8'));
if (map.sites.join() !== SITES.join()) throw new Error('public/map.json names other data sites; rerun encode.mjs');
if (meta.run !== map.version) throw new Error(`${mapDir} holds ${meta.run} but public/map.json is ${map.version}; rerun encode.mjs`);

const dumpDay = new Date(map.dumpDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const repoName = (s) => new URL(map.sites[s]).pathname.split('/').filter(Boolean)[0];

// Which files each site serves, with the size the probe expects.
const placed = map.sites.map(() => []);
for (const [table, owners] of Object.entries(map.files)) {
  owners.forEach((s, k) => {
    const name = `${table}-${String(k).padStart(2, '0')}.bin`;
    placed[s].push({ name, size: statSync(join(mapDir, name)).size });
  });
}

const README = `# Wikiracer map, part {part} of ${map.sites.length}

The link map behind [Wikiracer](https://wikiracer.kieronoates.workers.dev/). Built from the English Wikipedia dump of ${dumpDay}.

This repo only serves files for the site's shortest-route search, which reads them in small pieces with HTTP Range requests. The code that builds them lives in the [wikiracer](https://github.com/roff-dev/wikiracer) repo, under \`pipeline/\`.

Each version sits in its own folder (\`v${map.version}/\`) and replaces the previous one when I refresh the map.
`;

const LICENSE = `The files in this repository are a derived work of English Wikipedia's link tables
(dump of ${dumpDay}), made by Wikipedia contributors.

They are licensed under the Creative Commons Attribution-ShareAlike 4.0 International
licence (CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/

Source and its terms: https://dumps.wikimedia.org/legal.html
`;

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function build(s) {
  const repo = repoName(s);
  const dir = join(work, 'publish', repo);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, `v${map.version}`), { recursive: true });
  writeFileSync(join(dir, '.nojekyll'), '');
  writeFileSync(join(dir, 'README.md'), README.replace('{part}', s + 1));
  writeFileSync(join(dir, 'LICENSE'), LICENSE);
  // Hard links: the repo needs the files on disk for git, not a second 0.86 GB copy.
  for (const f of placed[s]) linkSync(join(mapDir, f.name), join(dir, `v${map.version}`, f.name));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `Publish the map from the ${dumpDay} dump`);
  return dir;
}

function audit(s, dir) {
  const problems = [];
  const expected = ['.nojekyll', 'LICENSE', 'README.md', ...placed[s].map((f) => `v${map.version}/${f.name}`)].sort();
  const tracked = git(dir, 'ls-files').split('\n').sort();
  if (tracked.join('\n') !== expected.join('\n')) problems.push(`tracked files differ: ${tracked.filter((f) => !expected.includes(f)).join(', ') || 'missing some'}`);
  if (git(dir, 'rev-list', '--count', 'HEAD') !== '1') problems.push('more than one commit');
  return { history: git(dir, 'log', '--format=%an <%ae>'), problems };
}

async function probe(s) {
  const pending = new Map(placed[s].map((f) => [f.name, f.size]));
  for (const [name, size] of [...pending]) {
    try {
      const res = await fetch(`${map.sites[s]}v${map.version}/${name}`, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
      await res.arrayBuffer();
      if (res.status === 206 && res.headers.get('content-range') === `bytes 0-0/${size}`) pending.delete(name);
    } catch { /* not up yet */ }
  }
  return pending.size;
}

if (!probeOnly) {
  for (let s = 0; s < map.sites.length; s++) {
    const dir = build(s);
    const { history, problems } = audit(s, dir);
    const bytes = placed[s].reduce((a, f) => a + f.size, 0);
    log(`${repoName(s)}: ${placed[s].length} chunk files, ${(bytes / 1e9).toFixed(3)} GB, commit by ${history}${problems.length ? '\n  ' + problems.join('\n  ') : ', audit clean'}`);
    if (problems.length) process.exit(1);
  }
  if (dryRun) {
    log(`dry run: repos built in ${join(work, 'publish')}, nothing pushed`);
    process.exit(0);
  }
  for (let s = 0; s < map.sites.length; s++) {
    const dir = join(work, 'publish', repoName(s));
    const remote = `https://github.com/${OWNER}/${repoName(s)}.git`;
    log(`pushing ${repoName(s)}`);
    execFileSync('git', ['-c', 'http.postBuffer=1048576000', 'push', '-q', '--force', remote, 'main'], { cwd: dir, stdio: 'inherit' });
  }
}

const pushed = Date.now();
const left = new Set(map.sites.keys());
while (left.size) {
  for (const s of [...left]) {
    const missing = await probe(s);
    if (!missing) {
      left.delete(s);
      log(`${repoName(s)}: all ${placed[s].length} files answer Range, ${((Date.now() - pushed) / 60_000).toFixed(1)} min after the push`);
    }
  }
  if (!left.size) break;
  if (Date.now() - pushed > PROBE_LIMIT) {
    log(`still waiting on ${[...left].map(repoName).join(', ')}: check each repo's Settings › Pages and its deployment, then rerun with --probe-only`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, PROBE_EVERY));
}
log('all data sites are live. Next: npm run map:check, then commit and push public/ so map.json and the indexes go live together');
