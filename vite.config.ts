import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Local development before the data sites are published: with WIKIRACER_MAP_DIR set to an
// encoder output folder (pipeline/work/map-<date>), `vite` and `vite preview` serve its chunk
// files with HTTP Range under /__map/ and point map.json's sites there. Never part of a build.
function localMap(dir: string): Plugin {
  const root = resolve(dir);
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/map.json') {
      const m = JSON.parse(readFileSync('public/map.json', 'utf8')) as { sites: string[] };
      m.sites = m.sites.map(() => '/__map/');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(m));
      return;
    }
    if (!path.startsWith('/__map/')) return next();
    const file = join(root, basename(path));
    if (!existsSync(file)) return void res.writeHead(404).end('not found');
    const size = statSync(file).size;
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (!m) return void res.writeHead(200, { 'Content-Length': size }).end(readFileSync(file));
    const a = Number(m[1]), b = Math.min(Number(m[2]), size - 1);
    res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start: a, end: b }).pipe(res);
  };
  return {
    name: 'wikiracer-local-map',
    apply: (_, env) => env.command === 'serve' || !!env.isPreview,
    configureServer: (s) => void s.middlewares.use(middleware),
    configurePreviewServer: (s) => void s.middlewares.use(middleware),
  };
}

const mapDir = process.env.WIKIRACER_MAP_DIR;

export default defineConfig({
  plugins: [svelte(), ...(mapDir ? [localMap(mapDir)] : [])],
  // The search worker is a module worker
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        home: 'index.html',
        race: 'race/index.html',
        result: 'race/result/index.html',
        room: 'room/index.html',
        challenge: 'challenge/index.html',
        daily: 'daily/index.html',
        about: 'about/index.html',
        privacy: 'privacy/index.html',
        terms: 'terms/index.html',
        notFound: '404.html',
      },
    },
  },
  // Rooms and challenges come from the Worker, run alongside with `wrangler dev`
  server: { host: true, proxy: { '/api': 'http://localhost:8787' } },
});
