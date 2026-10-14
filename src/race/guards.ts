// No going back and no Find, as far as a browser allows. Starting the race pushes one guard history
// entry; every way of going back (the Back button, Alt+←, the mouse's back button, swipe-back)
// lands on the entry before it, so the guard is pushed again and the player is told. Find's keys
// are cancelled. A browser's own menu Find can't be stopped: there the rules rely on honour.

export type Blocked = 'back' | 'find';

const GUARD = 'wikiracerGuard';

const isGuard = (state: unknown) => !!state && typeof state === 'object' && GUARD in state;

// Typing in a field keeps every key
export function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}

// The keys that open Find (and Firefox's quick find), or step back
export function blockedKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>): Blocked | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod && (key === 'f' || key === 'g')) return 'find';
  if (key === 'F3') return 'find';
  if (e.altKey && key === 'ArrowLeft') return 'back';
  if (inTextField(e.target)) return null;
  if (!mod && !e.altKey && (key === '/' || key === "'")) return 'find';
  if (key === 'Backspace') return 'back';
  return null;
}

interface NavigateEvent extends Event {
  navigationType: string;
  cancelable: boolean;
}

export function guardRace(onBlocked: (why: Blocked) => void): () => void {
  if (!isGuard(history.state)) history.pushState({ [GUARD]: true }, '', location.href);

  const onPop = (e: PopStateEvent) => {
    if (isGuard(e.state)) return;
    history.pushState({ [GUARD]: true }, '', location.href);
    onBlocked('back');
  };
  // Where the Navigation API exists, a cancelable traverse is stopped before it happens
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  const onNavigate = (e: Event) => {
    const n = e as NavigateEvent;
    if (n.navigationType === 'traverse' && n.cancelable) {
      n.preventDefault();
      onBlocked('back');
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const why = blockedKey(e);
    if (!why) return;
    e.preventDefault();
    e.stopPropagation();
    onBlocked(why);
  };
  const onUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  // a middle click would open the link's ?to= address in a new tab, outside the race
  const onAux = (e: MouseEvent) => {
    if ((e.target as Element).closest?.('a.race')) e.preventDefault();
  };

  addEventListener('popstate', onPop);
  nav?.addEventListener('navigate', onNavigate);
  addEventListener('keydown', onKey, true);
  addEventListener('beforeunload', onUnload);
  addEventListener('auxclick', onAux, true);
  const html = document.documentElement;
  html.classList.add('racing');

  return () => {
    removeEventListener('popstate', onPop);
    nav?.removeEventListener('navigate', onNavigate);
    removeEventListener('keydown', onKey, true);
    removeEventListener('beforeunload', onUnload);
    removeEventListener('auxclick', onAux, true);
    html.classList.remove('racing');
  };
}
