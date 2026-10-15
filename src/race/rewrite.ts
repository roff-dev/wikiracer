// Turns Wikipedia's Parsoid HTML into a race track. A link stays playable when it reaches another
// article, the same set the link map is built from (pagelinks): body text, tables, infobox,
// captions, references, hatnotes, image links, imagemap areas and navboxes. Everything else
// becomes plain text, so nothing on the page can take the player out of the game.
import { normaliseTitle } from '../search/titles.ts';

const NON_ARTICLE =
  /^(file|image|media|category|template|help|wikipedia|wp|portal|special|talk|user|draft|module|mediawiki|timedtext|book|gadget|gadget definition|topic|[a-z ]+ talk):/i;

export interface Rewritten {
  // Display title from the page, and the revision shown (for the attribution's permanent link)
  display: string;
  revision: string | null;
  // The rewritten <body>; its children go into the article column
  body: HTMLElement;
  // Every title the player can move to from this page
  links: Set<string>;
  // Titles reachable only through the navigation boxes ("N more links")
  navboxOnly: number;
  references: number;
}

// The article a link or imagemap area points at, or null when it isn't an article link.
export function linkTarget(a: Element): string | null {
  const href = a.getAttribute('href') ?? '';
  if (!href.startsWith('./')) return null;
  if (a.classList.contains('new')) return null; // red link: no such page
  if (a.tagName === 'A') {
    const rel = (a.getAttribute('rel') ?? '').split(/\s+/);
    if (!rel.includes('mw:WikiLink') && !a.closest('[typeof^="mw:File"]')) return null;
  } else if (a.tagName !== 'AREA') return null;
  let title: string;
  try {
    title = decodeURIComponent(href.slice(2).split('#')[0]!.split('?')[0]!);
  } catch {
    return null;
  }
  title = title.replaceAll('_', ' ').trim();
  if (!title || NON_ARTICLE.test(title)) return null;
  return normaliseTitle(title);
}

const https = (url: string) => (url.startsWith('//') ? 'https:' + url : url);

export function rewriteArticle(doc: Document, pageTitle?: string): Rewritten {
  const display = doc.querySelector('title')?.textContent?.trim() || (pageTitle ?? '').replaceAll('_', ' ');
  const self = normaliseTitle(pageTitle ?? display);
  const revision = /revision\/(\d+)/.exec(doc.documentElement.getAttribute('about') ?? '')?.[1] ?? null;
  const body = doc.body;

  for (const el of body.querySelectorAll('script, style, link, meta, base, .mw-editsection, .navbox-styles, .mw-empty-elt')) el.remove();
  for (const el of body.querySelectorAll<HTMLElement>('[style]')) {
    if (/display\s*:\s*none/i.test(el.getAttribute('style') ?? '')) el.remove();
  }

  const links = new Set<string>();
  const outside = new Set<string>();
  const inNavbox = new Set<string>();
  for (const a of body.querySelectorAll('a, area')) {
    const to = linkTarget(a);
    if (to && to !== self) {
      links.add(to);
      (a.closest('.navbox') ? inNavbox : outside).add(to);
      a.setAttribute('href', `?to=${encodeURIComponent(to)}`);
      a.setAttribute('data-to', to);
      for (const attr of ['rel', 'title', 'typeof', 'data-mw-i18n', 'id']) a.removeAttribute(attr);
      if (a.tagName === 'A') a.className = 'race';
    } else if (a.tagName === 'AREA') {
      a.remove();
    } else {
      const span = doc.createElement('span');
      span.append(...a.childNodes);
      a.replaceWith(span);
    }
  }
  let navboxOnly = 0;
  for (const t of inNavbox) if (!outside.has(t)) navboxOnly++;

  for (const img of body.querySelectorAll('img')) {
    img.setAttribute('src', https(img.getAttribute('src') ?? ''));
    const srcset = img.getAttribute('srcset');
    if (srcset) img.setAttribute('srcset', srcset.split(',').map((s) => https(s.trim())).join(', '));
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    // The credit sheet looks the file up by name when the image is tapped
    const file = /^\.\/File:(.+)$/.exec(img.getAttribute('resource') ?? '')?.[1];
    if (file) img.setAttribute('data-file', decodeURIComponent(file));
  }
  for (const el of body.querySelectorAll('[poster], source[src], video[src], audio[src]')) {
    for (const attr of ['src', 'poster']) {
      const v = el.getAttribute(attr);
      if (v) el.setAttribute(attr, https(v));
    }
  }

  // Wide tables scroll inside their own box, never the page. Not the floated panels: a scroll box
  // around one holds the float, so the text could only start below it on desktop
  for (const table of body.querySelectorAll('table')) {
    if (table.closest('.navbox, .infobox, .sidebar, .vertical-navbox') || table.parentElement?.closest('table')) continue;
    const wrap = doc.createElement('div');
    wrap.className = 'table-scroll';
    table.replaceWith(wrap);
    wrap.append(table);
  }

  let references = 0;
  for (const wrap of body.querySelectorAll('.mw-references-wrap')) {
    const n = wrap.querySelectorAll('ol.references > li').length;
    references += n;
    const details = doc.createElement('details');
    details.className = 'references';
    const summary = doc.createElement('summary');
    summary.textContent = `References (${n.toLocaleString('en-GB')})`;
    wrap.replaceWith(details);
    details.append(summary, wrap);
  }

  const navboxes = [...body.querySelectorAll('.navbox')].filter((n) => !n.parentElement?.closest('.navbox'));
  if (navboxes.length) {
    const details = doc.createElement('details');
    details.className = 'navboxes';
    const summary = doc.createElement('summary');
    summary.textContent = navboxOnly
      ? `Navigation boxes: ${navboxOnly.toLocaleString('en-GB')} more link${navboxOnly === 1 ? '' : 's'}`
      : 'Navigation boxes';
    details.append(summary, ...navboxes);
    body.append(details);
  }
  for (const s of body.querySelectorAll('section')) {
    if (!s.textContent?.trim() && !s.querySelector('img')) s.remove();
  }

  return { display, revision, body, links, navboxOnly, references };
}
