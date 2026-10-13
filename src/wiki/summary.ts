// Short descriptions from the page summary API (spec §8.2). Optional everywhere: a failure gives
// null and the card shows the title alone.
import { WIKI, wikiFetch } from './api.ts';

const cache = new Map<string, Promise<string | null>>();

export function shortDescription(title: string): Promise<string | null> {
  let p = cache.get(title);
  if (!p) {
    p = wikiFetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
      .then(async (r) => ((await r.json()) as { description?: string }).description ?? null)
      .catch(() => null);
    cache.set(title, p);
  }
  return p;
}
