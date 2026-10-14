// The theme choice from the menu: the system's, or light or dark. Applied as data-theme on <html>
// (tokens.css reads it); kept in localStorage, so a blocked store just means the system's.
import { readJson, writeJson } from './storage.ts';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'wikiracer.theme';

export function getTheme(): Theme {
  const t = readJson<string>(KEY, 'system');
  return t === 'light' || t === 'dark' ? t : 'system';
}

export function applyTheme(t: Theme = getTheme()): void {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  writeJson(KEY, t);
  applyTheme(t);
}
