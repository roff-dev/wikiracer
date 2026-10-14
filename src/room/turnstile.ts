// Turnstile, loaded only when someone opens the friends sheet, so a visitor who never does gets no
// third-party script. One invisible widget; each token is single-use, so the widget is reset
// before every new token.
import { TURNSTILE_SITE_KEY } from '../site.ts';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => reject(new Error('turnstile'));
    document.head.append(s);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

// A token from an invisible widget in `el`, or an error after 30 s
export async function turnstileToken(el: HTMLElement): Promise<string> {
  const api = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    let id = '';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
      queueMicrotask(() => api.remove(id));
    };
    const timer = setTimeout(() => done(() => reject(new Error('turnstile'))), 30_000);
    id = api.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => done(() => resolve(token)),
      'error-callback': () => done(() => reject(new Error('turnstile'))),
      'expired-callback': () => done(() => reject(new Error('turnstile'))),
    });
  });
}
