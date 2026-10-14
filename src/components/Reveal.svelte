<script lang="ts">
  // The reveal and the result under it, for a race just run and for a shared result. It plays the
  // session's levels (buffered ones re-timed, the rest live), then the breakthrough, the shortest
  // route, the par and the player's route, and settles into the result's map and text.
  import { flushSync, onDestroy, onMount, type Snippet } from 'svelte';
  import AllRoutes from './AllRoutes.svelte';
  import RouteLine from './RouteLine.svelte';
  import { knownPar } from '../data/courses';
  import { clock, displayTitle, plural, scoreWords } from '../data/share';
  import { RevealDirector, type Label, type RevealBeat } from '../map/reveal';
  import { MapRenderer, REVEAL } from '../map/renderer';
  import { startTier } from '../map/tiers';
  import { routeAvoiding } from '../search/dag';
  import { running, type SearchSession, type SessionEvent, type SessionStatus } from '../search/session';
  import { mapDateText } from '../site';
  import { checkRoute } from '../wiki/routecheck';

  let {
    session,
    from,
    to,
    route,
    clicks,
    seconds,
    voice,
    finished = true,
    stopped = false,
    takeover = $bindable(false),
    extra,
    others = [],
  }: {
    // null when this browser can't run the search
    session: SearchSession | null;
    from: string;
    to: string;
    // the player's route, start to the last article reached
    route: string[];
    clicks: number;
    seconds: number;
    // 'shared' speaks about someone else's race, 'race' to the player who just ran it
    voice: 'shared' | 'race';
    // false when the player gave up
    finished?: boolean;
    // a timed room's player who stopped once someone had won: no map, the route marked incomplete
    stopped?: boolean;
    takeover?: boolean;
    extra?: Snippet;
    // other players' routes (a room's standings), drawn beside yours
    others?: string[][];
  } = $props();

  type Status = SessionStatus | { kind: 'unsupported' };

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shared = $derived(voice === 'shared');

  let status = $state<Status>({ kind: 'loading' });
  let beat = $state<RevealBeat | null>(null);
  let explored = $state(0);
  let slow = $state(false);
  let labels = $state<Label[]>([]);
  let staticView = $state(false);
  let par = $state<{ d: number; k: number } | null>(null);
  let shortest = $state<string[]>([]);
  let shortestIds: number[] = [];
  let shortestChecks = $state<(boolean | null)[] | null>(null);
  let checkFailed = $state(false);
  let playerMissing = $state<number[]>([]);
  let showAll = $state(false);
  let announce = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let headline = $state<HTMLElement>();
  let director: RevealDirector | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let checkAbort: AbortController | null = null;
  let handled = false;
  let off: (() => void) | null = null;

  const dag = $derived(status.kind === 'found' ? status.dag : null);
  const settled = $derived(beat === 'settled' || staticView || (status.kind !== 'searching' && status.kind !== 'loading' && status.kind !== 'found'));
  const showText = $derived(!takeover || settled);
  const canvasLabel = $derived(
    status.kind === 'found'
      ? `Search map: ${plural(explored, 'article')} explored from both ends. The shortest route is ${plural(status.distance, 'click')}.`
      : `Search map: ${plural(explored, 'article')} explored from both ends.`,
  );
  const topLine = $derived(
    shared ? `This race: ${plural(clicks, 'click')} in ${clock(seconds)}` : finished ? `You made it: ${plural(clicks, 'click')} in ${clock(seconds)}.` : `You ${stopped ? 'stopped' : 'gave up'} after ${plural(clicks, 'click')}.`,
  );

  function found(distance: number): string {
    if (shared) return `This race took ${plural(clicks, 'click')}. The shortest route is ${distance}.`;
    if (finished) return `You took ${plural(clicks, 'click')}. The shortest route is ${distance}.`;
    return `You ${stopped ? 'stopped' : 'gave up'} after ${plural(clicks, 'click')}. The shortest route is ${distance}.`;
  }

  function startDirector() {
    director?.destroy();
    labels = [];
    beat = null;
    if (!canvas || staticView || !MapRenderer.supported()) {
      staticView = true;
      director = null;
      leaveTakeover();
      return;
    }
    director = new RevealDirector(canvas, {
      tier: startTier(),
      reducedMotion,
      onBeat: (b) => {
        beat = b;
        if (b === 'settled') leaveTakeover();
      },
      onLabels: (l) => (labels = l),
      onFallback: () => {
        staticView = true;
        leaveTakeover();
      },
    });
  }

  // A fresh reveal from what the session has so far, then whatever it sends next
  function begin() {
    if (!session) return;
    handled = false;
    clearTimeout(slowTimer);
    slow = false;
    explored = session.explored;
    startDirector();
    director?.hold(2500);
    for (const l of session.levels) director?.addLevel(l);
    if (running(session.status)) slowTimer = setTimeout(() => (slow = true), 8000);
    sync();
  }

  function onEvent(e: SessionEvent) {
    if (e.kind === 'restart') begin();
    else if (e.kind === 'level') director?.addLevel(e.level);
    else if (e.kind === 'progress') explored = session!.explored;
    else sync();
  }

  function sync() {
    if (!session) return;
    status = session.status;
    if (running(status) || handled) return;
    handled = true;
    clearTimeout(slowTimer);
    explored = session.explored;
    director?.searchDone();
    void conclude(session.status);
  }

  async function conclude(s: SessionStatus) {
    const client = session!.client;
    const hits = await client.lookup(route).catch(() => null);
    void client.check([route]).then(
      (m) => (playerMissing = m[0] ?? []),
      () => undefined,
    );
    if (s.kind !== 'found') {
      if (s.kind === 'error' && s.reason === 'unavailable') par = await knownPar(from, to);
      director?.settleWhenLanded();
      if (!director) leaveTakeover();
      return;
    }
    shortest = s.titles;
    shortestIds = s.featured;
    announce = `${found(s.distance).slice(0, -1)}: ${s.titles.map(displayTitle).join(', ')}.`;
    const ids = hits?.map((h) => h?.id ?? null) ?? route.map(() => null);
    director?.finale(s.dag, s.featured, s.titles.map(displayTitle), { ids, titles: route.map(displayTitle), open: !finished });
    if (!director) leaveTakeover();
    void check(s.titles);
  }

  async function check(titles: string[]) {
    checkAbort?.abort();
    checkAbort = new AbortController();
    shortestChecks = titles.slice(1).map(() => null);
    checkFailed = false;
    try {
      shortestChecks = await checkRoute(titles, checkAbort.signal);
    } catch {
      if (!checkAbort.signal.aborted) checkFailed = true;
    }
  }

  // A link on the featured route has gone from Wikipedia: offer another shortest route without it
  const removed = $derived(shortestChecks ? shortestChecks.flatMap((ok, i) => (ok === false ? [[shortestIds[i]!, shortestIds[i + 1]!] as [number, number]] : [])) : []);
  const another = $derived(dag && removed.length ? routeAvoiding(dag, shortestIds[0]!, shortestIds.at(-1)!, removed) : null);

  async function useAnother() {
    if (!another || !session) return;
    const titles = await session.client.titles(another).catch(() => null);
    if (!titles) return;
    shortestIds = another;
    shortest = titles;
    director?.renderer.setCourse(0, another, '#FFFFFF');
    director?.renderer.drawCourse(0);
    void check(titles);
  }

  function leaveTakeover() {
    if (!takeover) return;
    // focus once the result is in the DOM: inside a view transition that's after its callback, and
    // on phones the headline is hidden until then
    const done = () => {
      flushSync(() => (takeover = false));
      headline?.focus({ preventScroll: false });
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    if (doc.startViewTransition && !reducedMotion) doc.startViewTransition(done);
    else done();
  }

  function skip() {
    if (!takeover) return;
    director?.skip();
    // a search still running keeps drawing in the result's map
    leaveTakeover();
  }

  function onKey(e: KeyboardEvent) {
    if (takeover && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      skip();
    }
  }

  // Each other player's route in their own colour, once the shortest route is on the map
  let othersDrawn = '';
  $effect(() => {
    const list = others;
    if (status.kind !== 'found' || !list.length || !session || !director) return;
    const key = JSON.stringify(list);
    if (key === othersDrawn) return;
    othersDrawn = key;
    const client = session.client;
    void Promise.all(list.map((r) => client.lookup(r).catch(() => null))).then((all) =>
      all.forEach((hits, i) => {
        let fake = -1000 * (i + 1);
        const ids = list[i]!.map((_, j) => hits?.[j]?.id ?? fake--);
        director?.renderer.setCourse(2 + i, ids, REVEAL.others[i % REVEAL.others.length]!, list[i]!.at(-1) !== to);
        director?.renderer.drawCourse(2 + i);
      }),
    );
  });

  onMount(() => {
    if (!session) {
      status = { kind: 'unsupported' };
      takeover = false;
      void knownPar(from, to).then((p) => (par = p));
      return;
    }
    off = session.on(onEvent);
    begin();
  });

  onDestroy(() => {
    off?.();
    clearTimeout(slowTimer);
    checkAbort?.abort();
    director?.destroy();
  });
</script>

<svelte:window onkeydown={onKey} />

<section class="reveal" aria-labelledby="result-head">
  {#if !stopped}<div class="stage" class:takeover class:static={staticView} onpointerup={skip} role="presentation">
    {#if !staticView}
      <div class="canvas-wrap" role="img" aria-label={canvasLabel}><canvas bind:this={canvas}></canvas></div>
      <div class="labels" aria-hidden="true">
        {#each labels as l, i (i)}
          {#if !l.hidden}<span class="label {l.kind}" style:transform="translate({l.x}px, {l.y}px)">{l.text}</span>{/if}
        {/each}
      </div>
    {/if}
    {#if takeover}
      <p class="over top-line">{topLine}</p>
      {#if beat === 'par' || beat === 'yours'}
        {#if status.kind === 'found'}
          <p class="over par"><span class="par-num">{status.distance}</span><span>The shortest route is {plural(status.distance, 'click')}.</span></p>
        {/if}
      {:else if status.kind === 'searching' || status.kind === 'loading'}
        <p class="over working">Working out the shortest route…<br /><span>Explored {plural(explored, 'article')}</span></p>
      {/if}
      <p class="over skip">Tap to skip</p>
    {/if}
    {#if staticView && (status.kind === 'searching' || status.kind === 'loading')}
      <p class="static-count">Explored {plural(explored, 'article')}</p>
    {/if}
  </div>{/if}

  <div class="panel" class:hidden={!showText}>
    <p class="sr" aria-live="polite">{settled ? announce : ''}</p>
    {#if status.kind === 'found'}
      <h2 id="result-head" tabindex="-1" bind:this={headline}>{found(status.distance)}</h2>
      {#if finished}<p class="words">{scoreWords(clicks, status.distance, shared)}</p>{/if}
      {#if status.pathCount > 1}<p class="sub">There are {status.pathCount.toLocaleString('en-GB')} equally short routes.</p>{/if}
    {:else}
      <h2 id="result-head" tabindex="-1" bind:this={headline}>
        {#if status.kind === 'searching' || status.kind === 'loading'}Working out the shortest route…
        {:else if status.kind === 'noRoute'}No route exists from {displayTitle(from)} to {displayTitle(to)} in my map.
        {:else if status.kind === 'notInMap'}{displayTitle(status.title)} isn't in my map.
        {:else if status.kind === 'budget'}Finding the shortest route needs more of the map than most ({status.mb} MB so far).
        {:else if status.kind === 'unsupported'}This browser can't run my route finder, so the shortest route can't show here.
        {:else if status.kind === 'error' && status.reason === 'network'}I couldn't load part of the map. Check your connection and try again.
        {:else if status.kind === 'error' && status.reason === 'maintenance'}My map is being updated, which happens once a month and takes a few minutes. Try again shortly.
        {:else if status.kind === 'error' && status.reason === 'tooBig'}This course is too big for my map reader to find the shortest route.
        {:else if status.kind === 'error'}I can't reach my map of Wikipedia's links right now, so the shortest route will show here when it's back.
        {/if}
      </h2>
      {#if status.kind === 'searching' || status.kind === 'loading'}
        <p class="sub" aria-live="polite">Explored {plural(explored, 'article')}</p>
        {#if slow}<p class="sub">Slow connection: the map is still loading.</p>{/if}
      {:else if status.kind === 'noRoute' && finished}
        <p class="sub">{shared ? 'The race found' : 'You found'} a way my map doesn't have.</p>
      {:else if status.kind === 'notInMap'}
        <p class="sub">The article is newer than my map of Wikipedia's links ({mapDateText}).</p>
      {/if}
      {#if par}
        <p class="words">The shortest route is {plural(par.d, 'click')}.</p>
      {/if}
      {#if status.kind === 'budget'}
        <button class="pill secondary" type="button" onclick={() => session?.keepGoing()}>Keep going</button>
      {:else if status.kind === 'error' && (status.reason === 'network' || status.reason === 'unavailable' || status.reason === 'maintenance')}
        <button class="pill secondary" type="button" onclick={() => session?.start()}>Try again</button>
      {/if}
    {/if}

    {@render extra?.()}

    <div class="routes">
      <section>
        <h3><span class="key yours" aria-hidden="true"></span>{shared ? 'This race' : stopped ? 'Your route (incomplete)' : 'Your route'}</h3>
        <RouteLine titles={route} missing={playerMissing} open={!finished} />
      </section>
      {#if status.kind === 'found' && shortest.length}
        <section>
          <h3><span class="key shortest" aria-hidden="true"></span>The shortest route</h3>
          <RouteLine titles={shortest} checks={shortestChecks} onAnother={another ? useAnother : null} />
          <p class="check">
            {#if checkFailed}Couldn't check against today's Wikipedia.
            {:else if shortestChecks?.every((c) => c === true)}Every link checked against today's Wikipedia.
            {:else if shortestChecks?.some((c) => c === null)}Checking against today's Wikipedia…
            {/if}
          </p>
        </section>
      {/if}
    </div>

    {#if status.kind === 'found' && dag && session}
      {#if showAll}
        <h3 class="all-head">Every shortest route</h3>
        <AllRoutes {dag} loadTitles={(ids) => session.client.titles(ids)} />
      {:else}
        <button class="pill secondary" type="button" onclick={() => (showAll = true)}>Every shortest route</button>
      {/if}
    {/if}
    <p class="fresh">My map of Wikipedia's links is from {mapDateText}.</p>
  </div>
</section>

<style>
  .reveal {
    display: grid;
    gap: 28px;
    margin-top: 40px;
  }
  .stage {
    position: relative;
    aspect-ratio: 1;
    border-radius: 20px;
    overflow: hidden;
    background: var(--void);
    view-transition-name: stage;
  }
  .stage.static {
    aspect-ratio: auto;
    min-height: 0;
    background: none;
  }
  .stage.takeover {
    position: fixed;
    inset: 0;
    z-index: 30;
    aspect-ratio: auto;
    border-radius: 0;
    height: 100dvh;
    cursor: pointer;
    animation: rise 300ms ease-out;
  }
  @keyframes rise {
    from {
      opacity: 0;
    }
  }
  .canvas-wrap {
    position: absolute;
    inset: 0;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .label {
    position: absolute;
    left: 0;
    top: 0;
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #fff;
    font: 600 var(--size-13) / 18px var(--font);
    font-stretch: var(--stretch-data);
    text-shadow: 0 0 4px var(--void), 0 0 8px var(--void);
  }
  .label.yours {
    color: #ffd23f;
  }
  .over {
    position: absolute;
    left: var(--gutter);
    right: var(--gutter);
    margin: 0;
    color: #eceef5;
    pointer-events: none;
  }
  .top-line {
    top: calc(20px + env(safe-area-inset-top));
    font-size: var(--size-20);
    font-weight: 600;
  }
  .skip {
    bottom: calc(20px + env(safe-area-inset-bottom));
    color: #a0a6b8;
    font-size: var(--size-13);
  }
  .working {
    bottom: calc(56px + env(safe-area-inset-bottom));
    font-size: var(--size-16);
  }
  .working span {
    color: #a0a6b8;
    font-variant-numeric: tabular-nums;
  }
  .par {
    top: 50%;
    display: grid;
    justify-items: center;
    text-align: center;
    transform: translateY(-50%);
    text-shadow: 0 0 12px var(--void);
  }
  .par-num {
    font-size: clamp(5rem, 28vw, 11rem);
    font-weight: 800;
    line-height: 0.9;
    font-stretch: 125%;
    animation: par-land 900ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
  }
  @keyframes par-land {
    from {
      font-stretch: 75%;
      opacity: 0;
    }
    to {
      font-stretch: 125%;
      opacity: 1;
    }
  }
  .static-count {
    margin: 0;
    color: var(--ink-2);
  }

  .panel.hidden {
    visibility: hidden;
  }
  h2 {
    margin: 0;
    font-size: var(--size-31);
    font-weight: 720;
    font-stretch: var(--stretch-heading);
    line-height: 1.1;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  h2:focus {
    outline: none;
  }
  .words {
    margin: 10px 0 0;
    color: var(--signal);
    font-size: var(--size-20);
    font-weight: 650;
  }
  .sub {
    margin: 6px 0 0;
    color: var(--ink-2);
  }
  .panel > .pill {
    margin-top: 20px;
  }
  .routes {
    display: grid;
    gap: 28px;
    margin: 32px 0 24px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 14px;
    font-size: var(--size-16);
    font-weight: 600;
  }
  /* the map's line colours, shown on the void they're drawn on */
  .key {
    width: 28px;
    height: 14px;
    border-radius: 7px;
    background: var(--void);
    position: relative;
  }
  .key::after {
    content: '';
    position: absolute;
    left: 5px;
    right: 5px;
    top: 5.5px;
    height: 3px;
    border-radius: 2px;
  }
  .key.yours::after {
    background: #ffd23f;
  }
  .key.shortest::after {
    background: #fff;
  }
  .check {
    margin: 4px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .all-head {
    margin-top: 8px;
  }
  .fresh {
    margin: 28px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  @media (min-width: 900px) {
    .reveal {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 48px;
      align-items: start;
    }
    .stage:not(.takeover) {
      position: sticky;
      top: 24px;
    }
    .routes {
      grid-template-columns: 1fr 1fr;
    }
  }

  /* landscape phones: the map left (56%), held to the screen's height, the result right */
  @media (orientation: landscape) and (max-height: 500px) {
    .reveal {
      grid-template-columns: minmax(0, 56fr) minmax(0, 44fr);
      gap: 24px;
      align-items: start;
      margin-top: 16px;
    }
    .stage:not(.takeover) {
      position: sticky;
      top: 12px;
      height: calc(100svh - 24px);
      aspect-ratio: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .par-num,
    .stage.takeover {
      animation: none;
    }
  }
</style>
