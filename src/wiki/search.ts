// Title suggestions for the course setter, from Wikipedia's title search. Redirects come back as
// the article they point at ("USA" gives United States). No retries: a busy or failing search
// hands over to my own title index straight away, so typing never waits.
import { WIKI, actionUrl, wikiFetch } from './api.ts';

export interface Suggestion {
  // URL form (underscores)
  title: string;
  description: string | null;
  // the redirect typed, when the suggestion came through one
  via?: string;
}

interface SearchPage {
  key: string;
  title: string;
  description?: string | null;
  matched_title?: string | null;
}

export async function searchTitles(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch(`${WIKI}/w/rest.php/v1/search/title?${new URLSearchParams({ q, limit: '8' })}`, { signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const { pages } = (await res.json()) as { pages: SearchPage[] };
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const p of pages) {
    const title = p.key || p.title.replaceAll(' ', '_');
    if (seen.has(title)) continue;
    seen.add(title);
    out.push({ title, description: p.description ?? null, ...(p.matched_title ? { via: p.matched_title } : {}) });
  }
  return out;
}

// Whether an article is a disambiguation page (optional: null when Wikipedia can't say)
export async function isDisambiguation(title: string, signal?: AbortSignal): Promise<boolean | null> {
  try {
    const res = await wikiFetch(actionUrl({ action: 'query', titles: title, redirects: '1', prop: 'pageprops', ppprop: 'disambiguation' }), { signal, action: true });
    const j = (await res.json()) as { query?: { pages?: { pageprops?: { disambiguation?: string } }[] } };
    const page = j.query?.pages?.[0];
    return page ? page.pageprops?.disambiguation !== undefined : null;
  } catch {
    return null;
  }
}
