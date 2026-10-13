// "Checked against today's Wikipedia" (spec §3.3, §8.2): one Action API request per route asks
// which of each stop's links to the next stop still exist.
import { actionUrl, wikiFetch } from './api.ts';

interface LinksResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: { title: string; missing?: boolean; links?: { title: string }[] }[];
  };
  continue?: Record<string, string>;
}

const key = (t: string) => t.replace(/_/g, ' ');

// For a route of titles, true for each hop i (route[i] → route[i + 1]) that's still a link today.
export async function checkRoute(route: string[], signal?: AbortSignal): Promise<boolean[]> {
  const sources = route.slice(0, -1), targets = route.slice(1);
  const links = new Map<string, Set<string>>();
  const resolved = new Map<string, string>();
  let cont: Record<string, string> = {};
  for (let page = 0; page < 5; page++) {
    const url = actionUrl({
      action: 'query',
      prop: 'links',
      titles: [...new Set(sources)].join('|'),
      pltitles: [...new Set(targets)].join('|'),
      plnamespace: '0',
      pllimit: 'max',
      redirects: '1',
      ...cont,
    });
    const j = (await (await wikiFetch(url, { signal, action: true })).json()) as LinksResponse;
    for (const m of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) resolved.set(m.from, m.to);
    for (const p of j.query?.pages ?? []) {
      const set = links.get(p.title) ?? new Set<string>();
      for (const l of p.links ?? []) set.add(l.title);
      links.set(p.title, set);
    }
    if (!j.continue) break;
    cont = j.continue;
  }
  const canonical = (t: string) => {
    let k = key(t);
    for (let i = 0; i < 3 && resolved.has(k); i++) k = resolved.get(k)!;
    return k;
  };
  return sources.map((s, i) => links.get(canonical(s))?.has(key(targets[i]!)) ?? false);
}
