export const SITE_NAME = 'Wikiracer';
export const SITE_URL = 'https://wikiracer.kieronoates.workers.dev';
export const PROFILE_URL = 'https://github.com/roff-dev';
// The dump date of the map in public/map.json (keep the two equal)
export const MAP_DATE = '2026-10-01';

export const mapDateText = new Date(`${MAP_DATE}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Turnstile's site key is public by design. Cloudflare's invisible always-pass test key until the
// real widget exists (spec §7.1, M4); the Worker's secret decides what passes.
export const TURNSTILE_SITE_KEY = '1x00000000000000000000BB';
