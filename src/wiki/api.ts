// Wikipedia requests: at most 2 in flight; a 429 waits Retry-After (capped at 10 s)
// and retries twice. The Api-User-Agent header goes on Action API calls only, so the edge-cached
// REST GETs stay CORS-simple.
export const WIKI = 'https://en.wikipedia.org';
const MAX_IN_FLIGHT = 2;
const USER_AGENT = 'Wikiracer/1.0 (https://wikiracer.kieronoates.workers.dev)';

let active = 0;
const waiting: (() => void)[] = [];

async function slot(): Promise<() => void> {
  if (active >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  active++;
  return () => {
    active--;
    waiting.shift()?.();
  };
}

export class WikiError extends Error {
  constructor(readonly status: number) {
    super(`wikipedia ${status}`);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export async function wikiFetch(url: string, opts: { signal?: AbortSignal; action?: boolean; onSlowDown?: () => void } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const release = await slot();
    let res: Response;
    try {
      res = await fetch(url, { signal: opts.signal, headers: opts.action ? { 'Api-User-Agent': USER_AGENT } : undefined });
    } finally {
      release();
    }
    if (res.status !== 429 || attempt === 2) {
      if (!res.ok) throw new WikiError(res.status);
      return res;
    }
    opts.onSlowDown?.();
    const after = Number(res.headers.get('retry-after'));
    await sleep(1000 * Math.min(10, Number.isFinite(after) && after > 0 ? after : 1), opts.signal);
  }
}

export const actionUrl = (params: Record<string, string>) =>
  `${WIKI}/w/api.php?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })}`;
