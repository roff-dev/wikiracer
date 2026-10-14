import { Course, sha256 } from './course.ts';
import { CODE_RE, checkName, drawCode } from './names.ts';
import { validTitle } from './rules.ts';
import { verifyTurnstile } from './turnstile.ts';

export { Course };

export interface Env {
  COURSE: DurableObjectNamespace<Course>;
  TURNSTILE_SECRET: string;
}

const MAX_BODY = 16 * 1024;
const SEAT_RE = /^[\w-]{16,128}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function seatHash(request: Request): Promise<string | null> {
  const seat = request.headers.get('X-Seat');
  return seat && SEAT_RE.test(seat) ? sha256(seat) : null;
}

// A Durable Object call that fails once the free plan's daily quota is spent: rooms rest until
// 00:00 UTC, and solo races carry on (they never reach the Worker).
function resting(e: unknown): Response {
  const text = String((e as Error)?.message ?? e);
  if (/limit|exceeded|quota/i.test(text)) return json({ error: 'resting' }, 429);
  console.error(e);
  return json({ error: 'server' }, 500);
}

async function create(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: 'bad' }, 400);
  const { mode, from, to, name, turnstile } = body;
  if ((mode !== 'live' && mode !== 'challenge') || !validTitle(from) || !validTitle(to) || from === to) return json({ error: 'bad' }, 400);
  if (typeof name !== 'string' || !checkName(name).ok) return json({ error: 'name' }, 400);
  const human = await verifyTurnstile(turnstile, env.TURNSTILE_SECRET, request.headers.get('CF-Connecting-IP'), new URL(request.url).hostname);
  if (!human) return json({ error: 'turnstile' }, 403);
  // a taken code (one chance in 887 million per draw) is drawn again
  for (let i = 0; i < 5; i++) {
    const code = drawCode();
    if (await env.COURSE.get(env.COURSE.idFromName(code)).init(mode, from, to)) return json({ code }, 201);
  }
  return json({ error: 'server' }, 500);
}

export default {
  // Runs only for /api/* (assets.run_worker_first); every other path is a static asset
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/course') return request.method === 'POST' ? await create(request, env) : json({ error: 'method' }, 405);
      const m = /^\/api\/course\/([^/]+)(\/result|\/ws)?$/.exec(url.pathname);
      // a malformed code never reaches an object
      if (!m || !CODE_RE.test(m[1]!)) return json({ error: 'not_found' }, 404);
      const stub = env.COURSE.get(env.COURSE.idFromName(m[1]!));
      if (!m[2] && request.method === 'GET') {
        const info = await stub.info(await seatHash(request));
        return info ? json(info) : json({ error: 'expired' }, 404);
      }
      if (m[2] === '/result' && request.method === 'POST') {
        const hash = await seatHash(request);
        const body = await readBody(request);
        if (!hash || !body) return json({ error: 'bad' }, 400);
        const out = await stub.addResult(hash, body);
        if (out.ok) return json(out.table);
        const status = out.code === 'expired' ? 404 : out.code === 'full' || out.code === 'exists' ? 409 : 400;
        return json({ error: out.code }, status);
      }
      if (m[2] === '/ws' && request.method === 'GET') {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade' }, 426);
        return await stub.fetch(request);
      }
      return json({ error: 'method' }, 405);
    } catch (e) {
      return resting(e);
    }
  },
} satisfies ExportedHandler<Env>;
