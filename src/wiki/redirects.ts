// The other names of a few articles: every redirect to each, so a link written as "Leading man"
// can be matched to the article it lands on, "Leading actor". Titles in and out are underscored.
import { normaliseTitle } from '../search/titles.ts';
import { actionUrl, wikiFetch } from './api.ts';

interface RedirectsResponse {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: { title: string; redirects?: { title: string }[] }[];
  };
  continue?: Record<string, string>;
}

// Redirect title → the article it lands on, for every given article (and the given titles
// themselves, should one of them be a redirect)
export async function redirectsTo(titles: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += 50) {
    let cont: Record<string, string> = {};
    for (let page = 0; page < 10; page++) {
      const url = actionUrl({ action: 'query', prop: 'redirects', titles: unique.slice(i, i + 50).join('|'), rdlimit: 'max', rdnamespace: '0', redirects: '1', ...cont });
      const j = (await (await wikiFetch(url, { signal, action: true })).json()) as RedirectsResponse;
      for (const m of j.query?.redirects ?? []) out.set(normaliseTitle(m.from), normaliseTitle(m.to));
      for (const p of j.query?.pages ?? []) for (const r of p.redirects ?? []) out.set(normaliseTitle(r.title), normaliseTitle(p.title));
      if (!j.continue) break;
      cont = j.continue;
    }
  }
  return out;
}
