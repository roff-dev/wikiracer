// Step 5 of the map pipeline: pushes the chunk files to the four data sites (GitHub Pages).
//
//   node pipeline/publish.mjs [--map <dir>] [--dry-run] [--probe-only]
//   node pipeline/publish.mjs --restore [--rev <git rev>]
//
// --map defaults to the newest finished pipeline/work/map-<run>/ and must match public/map.json.
// Each data repo is rebuilt as a single fresh commit in pipeline/work/publish/<repo>/ and
// force-pushed to main, so an old version leaves the repo's history instead of piling up in it.
// --dry-run builds and audits the repos without pushing; --probe-only skips straight to waiting
// for the sites. After the push it waits until every chunk answers a 1-byte Range request.
//
// A 1 GB Pages site can't hold two versions, so pushing takes the live map off the data sites
// until the site's own map.json follows. Before pushing, each repo's current main is kept on a
// `previous` branch; --restore moves main back to it (a ref change on GitHub, nothing uploaded)
// and waits for the map that public/map.json names at --rev (default HEAD) to answer again.
// Branch changes go through `gh api`, so gh needs a token with Contents write on the data repos.
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
const dryRun = args.includes('--dry-run');
const probeOnly = args.includes('--probe-only');
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...a);
const repoOf = (site) => new URL(site).pathname.split('/').filter(Boolean)[0];

// Which files each site serves: [[{ name, size }]] by site; size null when it isn't known here.
function placement(m, sizeOf = () => null) {
  const placed = m.sites.map(() => []);
  for (const [table, owners] of Object.entries(m.files)) {
    owners.forEach((s, k) => {
      const name = `${table}-${String(k).padStart(2, '0')}.bin`;
      placed[s].push({ name, size: sizeOf(name) });
    });
  }
  return placed;
}

// How many of site s's files don't yet answer a 1-byte Range request (with the right size, when known).
async function probe(m, s, files) {
  let missing = 0;
  for (const { name, size } of files) {
    try {
      const res = await fetch(`${m.sites[s]}v${m.version}/${name}`, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
      await res.arrayBuffer();
      if (res.status === 206 && (size === null || res.headers.get('content-range') === `bytes 0-0/${size}`)) continue;
    } catch { /* not up yet */ }
    missing++;
  }
  return missing;
}

// Waits until every site serves all its files, or exits 1 after PROBE_LIMIT.
async function waitForSites(m, placed, rerun) {
  const since = Date.now();
  const left = new Set(m.sites.keys());
  while (left.size) {
    for (const s of [...left]) {
      if (await probe(m, s, placed[s])) continue;
      left.delete(s);
      log(`${repoOf(m.sites[s])}: all ${placed[s].length} files of v${m.version} answer Range, ${((Date.now() - since) / 60_000).toFixed(1)} min in`);
    }
    if (!left.size) break;
    if (Date.now() - since > PROBE_LIMIT) {
      log(`still waiting on ${[...left].map((s) => repoOf(m.sites[s])).join(', ')}: check each repo's Settings › Pages and its deployment, then ${rerun}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, PROBE_EVERY));
  }
}

const gh = (...a) => execFileSync('gh', ['api', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const refPath = (repo, branch) => `repos/${OWNER}/${repo}/git/refs/heads/${branch}`;
const shaOf = (repo, branch) => JSON.parse(gh(refPath(repo, branch))).object.sha;
function setBranch(repo, branch, sha) {
  try {
    gh('-X', 'PATCH', refPath(repo, branch), '-f', `sha=${sha}`, '-F', 'force=true');
  } catch {
    gh('-X', 'POST', `repos/${OWNER}/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`);
  }
}
// Whether a repo's main already serves this version (then it isn't worth keeping as `previous`).
function mainHas(repo, version) {
  try { gh(`repos/${OWNER}/${repo}/contents/v${version}?ref=main`); return true; } catch { return false; }
}

if (args.includes('--restore')) {
  const rev = opt('--rev') ?? 'HEAD';
  const live = JSON.parse(execFileSync('git', ['show', `${rev}:public/map.json`], { cwd: root, encoding: 'utf8' }));
  for (const site of live.sites) {
    const repo = repoOf(site);
    // not pushed to yet (an older `previous` there could be an even older map)
    if (mainHas(repo, live.version)) { log(`${repo}: main already serves v${live.version}`); continue; }
    const sha = shaOf(repo, 'previous');
    setBranch(repo, 'main', sha);
    log(`${repo}: main moved back to ${sha.slice(0, 7)}`);
  }
  await waitForSites(live, placement(live), 'rerun --restore');
  log(`all data sites serve v${live.version} again, the map the site names`);
  process.exit(0);
}

const mapDir = opt('--map') ?? newestWorkDir(work, 'map');
const map = JSON.parse(readFileSync(join(root, 'public', 'map.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(mapDir, 'meta.json'), 'utf8'));
if (map.sites.join() !== SITES.join()) throw new Error('public/map.json names other data sites; rerun encode.mjs');
if (meta.run !== map.version) throw new Error(`${mapDir} holds ${meta.run} but public/map.json is ${map.version}; rerun encode.mjs`);

const dumpDay = new Date(map.dumpDate + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const repoName = (s) => repoOf(map.sites[s]);

// Which files each site serves, with the size the probe expects.
const placed = placement(map, (name) => statSync(join(mapDir, name)).size);

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
  // Keep what each site serves now, so --restore can put it back. All four before any push: a
  // `previous` left over from an older refresh would restore the wrong map.
  for (let s = 0; s < map.sites.length; s++) {
    const repo = repoName(s);
    if (mainHas(repo, map.version)) { log(`${repo}: main already holds v${map.version}, previous left as it is`); continue; }
    const sha = shaOf(repo, 'main');
    setBranch(repo, 'previous', sha);
    log(`${repo}: kept main ${sha.slice(0, 7)} as previous`);
  }
  for (let s = 0; s < map.sites.length; s++) {
    const dir = join(work, 'publish', repoName(s));
    const remote = `https://github.com/${OWNER}/${repoName(s)}.git`;
    log(`pushing ${repoName(s)}`);
    execFileSync('git', ['-c', 'http.postBuffer=1048576000', 'push', '-q', '--force', remote, 'main'], { cwd: dir, stdio: 'inherit' });
  }
}

await waitForSites(map, placed, 'rerun with --probe-only');
log('all data sites are live. Next: npm run map:check, then commit and push public/ so map.json and the indexes go live together');
