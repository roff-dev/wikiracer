// Loads an article for the race: Parsoid HTML from Wikipedia's REST API, which follows redirects
// itself, so the final URL names the article the player actually landed on.
import { WIKI, WikiError, wikiFetch } from '../wiki/api.ts';
import { normaliseTitle } from '../search/titles.ts';
import { rewriteArticle, type Rewritten } from './rewrite.ts';

export interface Article extends Rewritten {
  // The article landed on, after redirects, in URL form (underscores)
  title: string;
}

const path = (title: string) => encodeURIComponent(title.replaceAll(' ', '_'));

// Where the request ended up after Wikipedia's redirects (…/page/<title>/html)
export function landedTitle(url: string, asked: string): string {
  const m = /\/page\/(?:html\/)?([^/?]+)(?:\/html)?(?:\?|$)/.exec(new URL(url, WIKI).pathname + '?');
  if (!m) return normaliseTitle(asked);
  try {
    return normaliseTitle(decodeURIComponent(m[1]!));
  } catch {
    return normaliseTitle(asked);
  }
}

export function parseArticle(html: string, title: string): Article {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { title, ...rewriteArticle(doc, title) };
}

export async function loadArticle(title: string, opts: { signal?: AbortSignal; onSlowDown?: () => void } = {}): Promise<Article> {
  const urls = [`${WIKI}/w/rest.php/v1/page/${path(title)}/html`, `${WIKI}/api/rest_v1/page/html/${path(title)}`];
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await wikiFetch(url, opts);
      return parseArticle(await res.text(), landedTitle(res.url || url, title));
    } catch (e) {
      // A missing article is final; anything else gets the second endpoint, then the error state
      if (opts.signal?.aborted || (e instanceof WikiError && e.status === 404)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export const articleUrl = (title: string) => `${WIKI}/wiki/${path(title)}`;
export const historyUrl = (title: string) => `${WIKI}/w/index.php?title=${path(title)}&action=history`;
export const revisionUrl = (title: string, revision: string) => `${WIKI}/w/index.php?title=${path(title)}&oldid=${revision}`;
