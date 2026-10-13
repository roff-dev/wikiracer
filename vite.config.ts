import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
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
