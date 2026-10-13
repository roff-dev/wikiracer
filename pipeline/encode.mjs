// Step 3 of the map pipeline: the CSR graph → the map's static files.
//
//   node --max-old-space-size=14000 pipeline/encode.mjs [--graph <dir>]
//
// --graph defaults to the newest finished pipeline/work/graph-<run>/. Writes the chunk files to
// pipeline/work/map-<run>/ (publish.mjs copies them to the data sites), and public/map.json plus
// public/map/v<run>/{out,in,tid,tkey}.idx, removing other versions' index folders.
//
// It checks itself with the browser's own decoders (lib/encode.mjs): every list is read back from
// the chunk files and compared with the CSR arrays, every title is read back both ways, and a
// sample of titles goes through the real lookup. Any mismatch stops it before map.json is written.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeMap, manifest, placeFiles } from './lib/encode.mjs';
import { loadGraph, newestWorkDir } from './lib/graph.mjs';
import { SITES } from './lib/sites.mjs';

const SITE_LIMIT = 0.95e9; // Pages allows 1 GB; past this the step-up is a fifth site

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'pipeline', 'work');
const graphDir = opt('--graph') ?? newestWorkDir(work, 'graph');
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's', ...a);

const g = loadGraph(graphDir);
const run = g.meta.dump;
const mapDir = join(work, `map-${run}`);
rmSync(mapDir, { recursive: true, force: true });
mkdirSync(mapDir, { recursive: true });
log(`graph ${run}: N ${g.N}, E ${g.meta.E}`);

const enc = await encodeMap(g, mapDir, { log, lookupTitles: ['Kevin_Bacon', 'Banana', 'Möbius_strip', 'Yıldırım_Akbulut'] });
const { files, load } = placeFiles(enc.fileSizes, SITES.length);
const over = load.findIndex((b) => b > SITE_LIMIT);
if (over >= 0) throw new Error(`site ${over + 1} would hold ${(load[over] / 1e9).toFixed(2)} GB; add a fifth data site`);
const report = { run, ...enc.report, siteBytes: load, files: Object.values(files).reduce((a, f) => a + f.length, 0) };

// Publish into the site: index files, then map.json last
const pub = join(root, 'public');
const idxDir = join(pub, 'map', `v${run}`);
mkdirSync(idxDir, { recursive: true });
for (const [k, v] of Object.entries(enc.indexes)) writeFileSync(join(idxDir, `${k}.idx`), v);
for (const d of readdirSync(join(pub, 'map'))) if (d !== `v${run}`) rmSync(join(pub, 'map', d), { recursive: true, force: true });
const map = manifest({ run, N: g.N, E: g.meta.E, sites: SITES, files, slots: enc.slots, tkeyBlocks: enc.tkeyBlocks, indexPath: (k) => `/map/v${run}/${k}.idx` });
writeFileSync(join(pub, 'map.json'), JSON.stringify(map, null, 1) + '\n');
writeFileSync(join(mapDir, 'meta.json'), JSON.stringify(report, null, 1));
log(`done: ${report.files} chunk files, sites ${load.map((b) => (b / 1e9).toFixed(3)).join(' / ')} GB, indexes ${Object.values(enc.indexes).reduce((a, b) => a + b.length, 0)} B`);
