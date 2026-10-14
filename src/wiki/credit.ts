// Image credits for the sheet that opens when an article image is tapped: author, licence and the
// file page, from the file's extmetadata. On failure the sheet shows the file page link alone.
import { WIKI, actionUrl, wikiFetch } from './api.ts';

export interface Credit {
  file: string;
  filePage: string;
  author: string | null;
  licence: string | null;
  licenceUrl: string | null;
  nonFree: boolean;
}

type Meta = Record<string, { value?: string } | undefined>;

// extmetadata values are HTML fragments; the sheet shows them as plain text
function text(html: string | undefined): string | null {
  if (!html) return null;
  const t = new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim();
  return t || null;
}

export const filePage = (file: string) => `${WIKI}/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`;

export function creditFrom(file: string, meta: Meta | undefined): Credit {
  const url = meta?.LicenseUrl?.value?.replace(/^http:/, 'https:') ?? null;
  return {
    file,
    filePage: filePage(file),
    author: text(meta?.Artist?.value) ?? text(meta?.Credit?.value),
    licence: text(meta?.LicenseShortName?.value) ?? text(meta?.UsageTerms?.value),
    licenceUrl: url,
    nonFree: meta?.NonFree?.value === 'true',
  };
}

const cache = new Map<string, Promise<Credit>>();

export function imageCredit(file: string): Promise<Credit> {
  let p = cache.get(file);
  if (!p) {
    p = wikiFetch(actionUrl({ action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'extmetadata' }), { action: true })
      .then(async (r) => {
        const j = (await r.json()) as { query?: { pages?: { imageinfo?: { extmetadata?: Meta }[] }[] } };
        return creditFrom(file, j.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata);
      })
      .catch(() => {
        cache.delete(file);
        return creditFrom(file, undefined);
      });
    cache.set(file, p);
  }
  return p;
}
