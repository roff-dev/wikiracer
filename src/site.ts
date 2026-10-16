import map from '../public/map.json' with { type: 'json' };

export const SITE_NAME = 'Wikiracer';
export const SITE_URL = 'https://wikiracer.kieronoates.workers.dev';
export const PROFILE_URL = 'https://github.com/roff-dev';
// From the map the site is built with, so a refresh updates every mention
export const MAP_DATE = map.dumpDate;
export const MAP_ARTICLES = map.N;
export const MAP_LINKS = map.E;

export const mapDateText = new Date(`${MAP_DATE}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Turnstile's site key is public by design. Cloudflare's invisible always-pass test key until the
// real widget exists; the Worker's secret decides what passes.
export const TURNSTILE_SITE_KEY = '1x00000000000000000000BB';
// Cloudflare Web Analytics (cookie-free). The beacon is added to every page at build time once the
// token is set; empty means no analytics.
export const ANALYTICS_TOKEN = '';
