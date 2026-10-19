<script lang="ts">
  // One place a race left the shortest routes, shown on today's version of the article: the link
  // taken marked in the route's yellow, the links that would have kept to a shortest route in
  // green, and a bar that steps through them in page order, as Find does. It covers the result
  // and takes a history entry, so Back (or Esc, or Close) returns to it.
  import { onDestroy, onMount, tick } from 'svelte';
  import Article from './Article.svelte';
  import { displayTitle, plural } from '../data/share';
  import { readTextSize } from '../data/textSize';
  import { loadArticle, type Article as Loaded } from '../race/article';
  import { normaliseTitle } from '../search/titles';
  import { redirectsTo } from '../wiki/redirects';

  let {
    title,
    clicked,
    best,
    shared = false,
    onclose,
  }: {
    // the article the race left the shortest routes on
    title: string;
    // the link taken from it, as landed on
    clicked: string;
    // the links that stayed on a shortest route, most routes first
    best: string[];
    shared?: boolean;
    onclose: () => void;
  } = $props();

  type Kind = 'yours' | 'best';
  type Match = { el: HTMLElement; kind: Kind; to: string };

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scale = readTextSize();
  const ctrl = new AbortController();
  let article = $state.raw<Loaded | null>(null);
  let failed = $state(false);
  let matches = $state.raw<Match[]>([]);
  let current = $state(-1);
  let unmarked = $state<string[]>([]);
  let view = $state<HTMLElement>();
  let closeBtn = $state<HTMLButtonElement>();

  const who = $derived(shared ? 'the race' : 'you');
  const now = $derived(matches[current]);

  async function load() {
    // the article as it is today, and every other name of the links to mark
    const wanted = [clicked, ...best];
    try {
      const [a, redirects] = await Promise.all([
        loadArticle(title, { signal: ctrl.signal }),
        redirectsTo(wanted, ctrl.signal).catch(() => new Map<string, string>()),
      ]);
      article = a;
      await tick();
      mark(redirects);
    } catch {
      if (!ctrl.signal.aborted) failed = true;
    }
  }

  function mark(redirects: Map<string, string>) {
    const yours = normaliseTitle(clicked);
    const good = new Set(best.map(normaliseTitle));
    const found: Match[] = [];
    for (const el of view?.querySelectorAll<HTMLElement>('.article a.race[data-to]') ?? []) {
      const to = redirects.get(el.dataset.to!) ?? el.dataset.to!;
      const kind: Kind | null = to === yours ? 'yours' : good.has(to) ? 'best' : null;
      if (!kind) continue;
      el.classList.add('mark', kind);
      found.push({ el, kind, to });
    }
    matches = found;
    unmarked = [clicked, ...best].filter((t) => !found.some((m) => m.to === normaliseTitle(t)));
    // the link taken first: where the player was
    go(Math.max(0, found.findIndex((m) => m.kind === 'yours')));
  }

  function go(i: number) {
    if (!matches.length) return;
    current = (i + matches.length) % matches.length;
    const m = matches[current]!;
    for (const x of matches) x.el.classList.toggle('current', x === m);
    // a link inside a collapsed navbox or reference list: open it first
    for (let d = m.el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    m.el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  // a marked link tapped on the page becomes the current one; other links go nowhere here
  function tapped(_to: string, el: Element) {
    const k = matches.findIndex((m) => m.el === el);
    if (k >= 0) go(k);
  }

  const close = () => history.back();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      go(current + (e.shiftKey ? -1 : 1));
    }
  }

  onMount(() => {
    history.pushState({ wikiracerMissed: true }, '');
    addEventListener('popstate', onclose);
    document.documentElement.classList.add('reviewing');
    closeBtn?.focus();
    void load();
  });

  onDestroy(() => {
    ctrl.abort();
    removeEventListener('popstate', onclose);
    document.documentElement.classList.remove('reviewing');
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="review" role="dialog" aria-modal="true" aria-labelledby="review-head">
  <header class="top">
    <button class="close hover-fill" type="button" onclick={close} bind:this={closeBtn}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 5l-5 5 5 5" /></svg>
      Results
    </button>
    <p id="review-head" class="what">
      On {displayTitle(title)}, {who} took <span class="chip yours">{displayTitle(clicked)}</span>.
      <span class="chip best">{displayTitle(best[0] ?? '')}</span>{best.length > 1 ? `, or ${plural(best.length - 1, 'other link')},` : ''} would have kept {shared ? 'it' : 'you'} on a shortest route.
    </p>
  </header>

  <div class="page" bind:this={view} style:--text-scale={scale}>
    <Article {article} pending={displayTitle(title)} onmove={tapped} note={failed ? loadNote : undefined} />
  </div>

  <div class="bar" role="toolbar" aria-label="Marked links">
    <p class="now" aria-live="polite">
      {#if failed}Couldn't load the article.
      {:else if !article}Loading {displayTitle(title)}…
      {:else if now}<span class="dot {now.kind}" aria-hidden="true"></span><span class="pair"><span class="kind">{now.kind === 'yours' ? 'Your click' : 'Shortest route'}<span class="sr">:</span></span> <span class="name">{displayTitle(now.to)}</span></span>
      {:else}Neither link is on today's version of this article.{/if}
    </p>
    {#if matches.length}<span class="count">{current + 1} of {matches.length}</span>{/if}
    <button class="step hover-fill" type="button" aria-label="Previous marked link" disabled={matches.length < 2} onclick={() => go(current - 1)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12l5-5 5 5" /></svg>
    </button>
    <button class="step hover-fill" type="button" aria-label="Next marked link" disabled={matches.length < 2} onclick={() => go(current + 1)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
    </button>
  </div>
  {#if article && matches.length && unmarked.length}
    <p class="gone">{unmarked.map(displayTitle).join(', ')} {unmarked.length === 1 ? "isn't" : "aren't"} linked on today's version of this article.</p>
  {/if}
</div>

{#snippet loadNote()}
  <div class="note">
    <p>Couldn't load {displayTitle(title)} from Wikipedia. Check your connection.</p>
    <button class="pill secondary" type="button" onclick={() => ((failed = false), load())}>Try again</button>
  </div>
{/snippet}

<style>
  :global(html.reviewing) {
    overflow: hidden;
  }
  .review {
    position: fixed;
    inset: 0;
    z-index: 35;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--bg);
    color: var(--ink);
  }
  .top {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    padding: 8px var(--gutter) 10px 8px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  .close {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 14px 0 8px;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    font: 600 var(--size-16) / 1 var(--font);
    cursor: pointer;
  }
  .what {
    flex: 1 1 24rem;
    margin: 0;
    padding-left: 8px;
    color: var(--ink-2);
    font-size: var(--size-13);
    line-height: 1.7;
  }
  .chip {
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--ink);
    font-weight: 650;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .chip.yours,
  .page :global(.article a.race.mark.yours) {
    background: color-mix(in srgb, #ffd23f 55%, transparent);
  }
  .chip.best,
  .page :global(.article a.race.mark.best) {
    background: color-mix(in srgb, var(--signal) 22%, transparent);
  }
  .page :global(.article a.race.mark) {
    border-radius: 3px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  .page :global(.article a.race.mark.yours) {
    color: var(--ink);
    text-decoration-color: currentColor;
  }
  .page :global(.article a.race.mark.best) {
    text-decoration-color: var(--signal);
  }
  /* the one the bar is on, as Find marks its current match */
  .page :global(.article a.race.mark.current) {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .page {
    padding-bottom: calc(96px + env(safe-area-inset-bottom));
  }
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: calc(64px + env(safe-area-inset-bottom));
    padding: 0 8px env(safe-area-inset-bottom) var(--gutter);
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  .now {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 0;
    font-weight: 600;
  }
  .pair {
    display: grid;
    min-width: 0;
    line-height: 1.2;
  }
  .kind {
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 550;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 4px;
  }
  .dot.yours {
    background: #ffd23f;
  }
  .dot.best {
    background: var(--signal);
  }
  .count {
    flex: none;
    margin-right: 4px;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-variant-numeric: tabular-nums;
  }
  .step {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .step:disabled {
    opacity: 0.4;
    cursor: default;
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .gone {
    position: fixed;
    left: var(--gutter);
    right: var(--gutter);
    bottom: calc(72px + env(safe-area-inset-bottom));
    z-index: 2;
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--bg-sunk);
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .note {
    margin: 0 0 28px;
    padding: 16px;
    border-radius: 12px;
    background: var(--bg-sunk);
  }
  .note p {
    margin: 0 0 14px;
  }
  @media (min-width: 900px) {
    .top {
      padding-left: var(--edge);
      padding-right: var(--edge);
    }
    .bar {
      left: 50%;
      right: auto;
      bottom: 16px;
      width: min(560px, calc(100vw - 32px));
      min-height: 60px;
      padding: 0 8px 0 18px;
      transform: translateX(-50%);
      border: 1px solid var(--line);
      border-radius: 999px;
      box-shadow: var(--shadow-sheet);
    }
    .gone {
      left: 50%;
      right: auto;
      bottom: 88px;
      width: min(560px, calc(100vw - 32px));
      transform: translateX(-50%);
    }
  }
</style>
