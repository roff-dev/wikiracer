import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { ANALYTICS_TOKEN, SITE_NAME, SITE_URL } from './src/site.ts';

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

// Preload the Latin Mona Sans file on every page, so the display titles don't reflow when the
// font arrives
const preloadFont: Plugin = {
  name: 'wikiracer-preload-font',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const font = Object.keys(ctx.bundle ?? {}).find((n) => /mona-sans-latin-wdth-normal-[^/]*\.woff2$/.test(n));
      return font ? [{ tag: 'link', attrs: { rel: 'preload', href: `/${font}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' }] : [];
    },
  },
};

// The tags every page shares, from its own <title>, description and canonical link: icons, the
// social card, noindex on pages that only mean something with a code or route in the URL, and
// the analytics beacon in builds once its token is set
const NOINDEX = ['/race/', '/race/result/', '/room/', '/challenge/', '/404.html'];

const siteHead: Plugin = {
  name: 'wikiracer-site-head',
  transformIndexHtml(html, ctx) {
    const pick = (re: RegExp) => re.exec(html)?.[1] ?? '';
    const title = pick(/<title>([^<]*)<\/title>/);
    const description = pick(/<meta name="description" content="([^"]*)"/);
    const url = pick(/<link rel="canonical" href="([^"]*)"/) || `${SITE_URL}/`;
    const path = ctx.path.replace(/index\.html$/, '');
    const meta = (attrs: Record<string, string>) => ({ tag: 'meta', attrs, injectTo: 'head' as const });
    const link = (attrs: Record<string, string>) => ({ tag: 'link', attrs, injectTo: 'head' as const });
    return [
      link({ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }),
      link({ rel: 'icon', href: '/favicon-32.png', sizes: '32x32', type: 'image/png' }),
      link({ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }),
      meta({ property: 'og:type', content: 'website' }),
      meta({ property: 'og:site_name', content: SITE_NAME }),
      meta({ property: 'og:title', content: title }),
      meta({ property: 'og:description', content: description }),
      meta({ property: 'og:url', content: url }),
      meta({ property: 'og:image', content: `${SITE_URL}/og.png` }),
      meta({ property: 'og:image:width', content: '1200' }),
      meta({ property: 'og:image:height', content: '630' }),
      meta({ property: 'og:image:alt', content: 'Wikiracer: get from one Wikipedia article to another by tapping links.' }),
      meta({ name: 'twitter:card', content: 'summary_large_image' }),
      ...(NOINDEX.includes(path) ? [meta({ name: 'robots', content: 'noindex' })] : []),
      // the goo filter the buttons' hover fill uses (base.css): blur, then a hard alpha threshold
      {
        tag: 'svg',
        attrs: { width: '0', height: '0', style: 'position: absolute', 'aria-hidden': 'true', focusable: 'false' },
        children:
          '<filter id="goo-fill" x="-10%" y="-40%" width="120%" height="180%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="5" /><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" /></filter>',
        injectTo: 'body-prepend' as const,
      },
      ...(ANALYTICS_TOKEN && !ctx.server
        ? [{ tag: 'script', attrs: { defer: true, src: 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': JSON.stringify({ token: ANALYTICS_TOKEN }) }, injectTo: 'body' as const }]
        : []),
    ];
  },
};

const mapDir = process.env.WIKIRACER_MAP_DIR;

export default defineConfig({
  plugins: [svelte(), preloadFont, siteHead, ...(mapDir ? [localMap(mapDir)] : [])],
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
  server: { host: true, proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});
