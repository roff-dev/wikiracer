// The map's data sites: one GitHub Pages project site per repo, under an organisation of their own.
export const OWNER = 'wikiracer-map';
export const REPOS = [1, 2, 3, 4].map((k) => `map-${k}`);
export const SITES = REPOS.map((r) => `https://${OWNER}.github.io/${r}/`);
