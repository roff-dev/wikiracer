<script lang="ts">
  // The shared result (spec §3.7): rebuilt from its URL. The course and the race's clicks and
  // time show at once; the routes stay behind a spoiler button, which runs the search and the
  // reveal, unless this browser has already finished the course.
  import { flushSync, onDestroy, tick } from 'svelte';
  import AllRoutes from '../components/AllRoutes.svelte';
  import CourseHero from '../components/CourseHero.svelte';
  import Footer from '../components/Footer.svelte';
  import RouteLine from '../components/RouteLine.svelte';
  import { knownPar } from '../data/courses';
  import { clicksOf, clock, displayTitle, parseResult, plural, scoreWords } from '../data/share';
  import { hasFinished } from '../data/storage';
  import { RevealDirector, type Label, type RevealBeat } from '../map/reveal';
  import { MapRenderer } from '../map/renderer';
  import { startTier } from '../map/tiers';
  import { SearchClient, type SearchHandle } from '../search/client';
  import { routeAvoiding } from '../search/dag';
  import type { Dag, SearchErrorReason } from '../search/protocol';
  import { mapDateText } from '../site';
  import { checkRoute } from '../wiki/routecheck';

  type Status =
    | { kind: 'loading' }
    | { kind: 'searching' }
    | { kind: 'budget'; mb: number }
    | { kind: 'found'; distance: number; pathCount: number }
    | { kind: 'noRoute' }
    | { kind: 'notInMap'; title: string }
    | { kind: 'error'; reason: SearchErrorReason }
    | { kind: 'unsupported' };

  const shared = parseResult(location.search);
  const route = shared ? [shared.from, ...shared.via, shared.to] : [];
  const clicks = shared ? clicksOf(shared) : 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raceHref = shared ? `/race/?${new URLSearchParams({ from: shared.from, to: shared.to })}` : '/';

  let open = $state(false);
  let takeover = $state(false);
  let status = $state<Status>({ kind: 'loading' });
  let beat = $state<RevealBeat | null>(null);
  let explored = $state(0);
  let slow = $state(false);
  let labels = $state<Label[]>([]);
  let staticView = $state(false);
  let par = $state<{ d: number; k: number } | null>(null);
  let dag = $state.raw<Dag | null>(null);
  let shortest = $state<string[]>([]);
  let shortestIds: number[] = [];
  let shortestChecks = $state<(boolean | null)[] | null>(null);
  let checkFailed = $state(false);
  let sharerMissing = $state<number[]>([]);
  let showAll = $state(false);
  let announce = $state('');

  let canvas = $state<HTMLCanvasElement>();
  let headline = $state<HTMLElement>();
  let director: RevealDirector | null = null;
  let client: SearchClient | null = null;
  let handle: SearchHandle | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let checkAbort: AbortController | null = null;
  // ids of the race's stops (null where a title isn't in my map)
  let sharerIds: (number | null)[] = [];

  const settled = $derived(beat === 'settled' || staticView || (status.kind !== 'searching' && status.kind !== 'loading' && status.kind !== 'found'));
  const showText = $derived(!takeover || settled);
  const canvasLabel = $derived(
    status.kind === 'found'
      ? `Search map: ${plural(explored, 'article')} explored from both ends. The shortest route is ${plural(status.distance, 'click')}.`
      : `Search map: ${plural(explored, 'article')} explored from both ends.`,
  );

  function supported(): boolean {
    return typeof Worker !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof fetch !== 'undefined';
  }

  async function show(auto: boolean) {
    if (!shared) return;
    open = true;
    takeover = !auto;
    await tick();
    if (!supported()) {
      status = { kind: 'unsupported' };
      par = await knownPar(shared.from, shared.to);
      takeover = false;
      return;
    }
    void run();
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

  async function run() {
    if (!shared) return;
    handle?.cancel();
    clearTimeout(slowTimer);
    status = { kind: 'loading' };
    explored = 0;
    slow = false;
    startDirector();
    client ??= new SearchClient();
    let hits;
    try {
      hits = await client.lookup(route);
    } catch (e) {
      fail((e as Error).message as SearchErrorReason);
      return;
    }
    const [a, b] = [hits[0], hits.at(-1)];
    if (!a || !b) {
      status = { kind: 'notInMap', title: !a ? shared.from : shared.to };
      leaveTakeover();
      return;
    }
    sharerIds = hits.map((h) => h?.id ?? null);
    status = { kind: 'searching' };
    slowTimer = setTimeout(() => (slow = true), 8000);
    director?.hold(2500);
    handle = client.search(a.id, b.id, director?.drawBudget ?? 5000, {
      onNodes: (side, depth, ids, angles, parentAngles) => director?.addLevel({ side, depth, ids, angles, parentAngles }),
      onProgress: (n) => (explored = n),
      onBudget: (bytes) => (status = { kind: 'budget', mb: Math.round(bytes / 1048576) }),
      onError: (reason) => fail(reason),
      onDone: (r) => void found(r.distance, r.pathCount, r.explored, r.dag, r.featured),
    });
  }

  async function fail(reason: SearchErrorReason) {
    clearTimeout(slowTimer);
    director?.searchDone();
    status = { kind: 'error', reason };
    director?.settleWhenLanded();
    if (!director) leaveTakeover();
    if (reason === 'unavailable' && shared) par = await knownPar(shared.from, shared.to);
  }

  async function found(distance: number | null, pathCount: number, n: number, d: Dag | null, featured: number[] | null) {
    clearTimeout(slowTimer);
    explored = n;
    director?.searchDone();
    void client!.check([route]).then(
      (m) => (sharerMissing = m[0] ?? []),
      () => undefined,
    );
    if (distance === null || !featured || !d) {
      status = { kind: 'noRoute' };
      director?.settleWhenLanded();
      if (!director) leaveTakeover();
      return;
    }
    let titles: string[];
    try {
      titles = await client!.titles(featured);
    } catch (e) {
      void fail((e as Error).message as SearchErrorReason);
      return;
    }
    dag = d;
    shortest = titles;
    shortestIds = featured;
    status = { kind: 'found', distance, pathCount };
    announce = `This race took ${plural(clicks, 'click')}. The shortest route is ${distance}: ${titles.map(displayTitle).join(', ')}.`;
    director?.finale(d, featured, titles.map(displayTitle), { ids: sharerIds, titles: route.map(displayTitle) });
    if (!director) leaveTakeover();
    void check(titles);
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
    if (!another || !client) return;
    const titles = await client.titles(another).catch(() => null);
    if (!titles) return;
    shortestIds = another;
    shortest = titles;
    director?.renderer.setCourse(0, another, '#FFFFFF');
    director?.renderer.drawCourse(0);
    void check(titles);
  }

  function leaveTakeover() {
    if (!takeover) return;
    const done = () => flushSync(() => (takeover = false));
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    if (doc.startViewTransition && !reducedMotion) doc.startViewTransition(done);
    else done();
    void tick().then(() => headline?.focus({ preventScroll: false }));
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

  if (shared && hasFinished(shared.from, shared.to)) void show(true);

  function leave() {
    handle?.cancel();
    checkAbort?.abort();
  }
  addEventListener('pagehide', leave);
  onDestroy(() => {
    leave();
    removeEventListener('pagehide', leave);
    director?.destroy();
    client?.terminate();
  });
</script>

<svelte:window onkeydown={onKey} />

<header class="top">
  <a class="wordmark" href="/">wikiracer</a>
</header>

{#if !shared}
  <main class="page" id="main">
    <h1 class="missing">This result link is incomplete.</h1>
    <p class="lede">It needs a start, a finish and a time. Ask for the link again, or pick a course yourself.</p>
    <a class="pill primary" href="/">Go to the home page</a>
  </main>
{:else}
  <main class="result" class:open id="main">
    <section class="intro">
      <CourseHero from={shared.from} to={shared.to} />
      <p class="score">
        <span class="clicks"><span class="num">{clicks}</span> {clicks === 1 ? 'click' : 'clicks'}</span>
        <span class="time">in {clock(shared.seconds)}</span>
      </p>
      <p class="lede">Someone raced from {displayTitle(shared.from)} to {displayTitle(shared.to)} by tapping links, and sent you their result. Fewest clicks wins.</p>
      <div class="actions">
        <a class="pill primary" href={raceHref}>Race it yourself</a>
        {#if !open}
          <button class="pill secondary" type="button" onclick={() => show(false)}>Show the routes (spoilers)</button>
        {/if}
      </div>
      {#if !open}
        <p class="hint">The routes give the course away. Race it first if you'd rather find your own.</p>
      {/if}
    </section>

    {#if open}
      <section class="reveal" aria-labelledby="result-head">
        <div class="stage" class:takeover class:static={staticView} onpointerup={skip} role="presentation">
          {#if !staticView}
            <div class="canvas-wrap" role="img" aria-label={canvasLabel}><canvas bind:this={canvas}></canvas></div>
            <div class="labels" aria-hidden="true">
              {#each labels as l, i (i)}
                {#if !l.hidden}<span class="label {l.kind}" style:transform="translate({l.x}px, {l.y}px)">{l.text}</span>{/if}
              {/each}
            </div>
          {/if}
          {#if takeover}
            <p class="over top-line">This race: {plural(clicks, 'click')} in {clock(shared.seconds)}</p>
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
        </div>

        <div class="panel" class:hidden={!showText}>
          <p class="sr" aria-live="polite">{settled ? announce : ''}</p>
          {#if status.kind === 'found'}
            <h2 id="result-head" tabindex="-1" bind:this={headline}>
              This race took {plural(clicks, 'click')}. The shortest route is {status.distance}.
            </h2>
            <p class="words">{scoreWords(clicks, status.distance, true)}</p>
            {#if status.pathCount > 1}<p class="sub">There are {status.pathCount.toLocaleString('en-GB')} equally short routes.</p>{/if}
          {:else}
            <h2 id="result-head" tabindex="-1" bind:this={headline}>
              {#if status.kind === 'searching' || status.kind === 'loading'}Working out the shortest route…
              {:else if status.kind === 'noRoute'}No route exists from {displayTitle(shared.from)} to {displayTitle(shared.to)} in my map.
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
            {:else if status.kind === 'noRoute'}
              <p class="sub">The race found a way my map doesn't have.</p>
            {:else if status.kind === 'notInMap'}
              <p class="sub">The article is newer than my map of Wikipedia's links ({mapDateText}).</p>
            {/if}
            {#if par}
              <p class="words">The shortest route is {plural(par.d, 'click')}.</p>
            {/if}
            {#if status.kind === 'budget'}
              <button class="pill secondary" type="button" onclick={() => (handle?.keepGoing(), (status = { kind: 'searching' }))}>Keep going</button>
            {:else if status.kind === 'error' && (status.reason === 'network' || status.reason === 'unavailable' || status.reason === 'maintenance')}
              <button class="pill secondary" type="button" onclick={() => run()}>Try again</button>
            {/if}
          {/if}

          <div class="routes">
            <section>
              <h3><span class="key yours" aria-hidden="true"></span>This race</h3>
              <RouteLine titles={route} missing={sharerMissing} />
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

          {#if status.kind === 'found' && dag}
            {#if showAll}
              <h3 class="all-head">Every shortest route</h3>
              <AllRoutes {dag} loadTitles={(ids) => client!.titles(ids)} />
            {:else}
              <button class="pill secondary" type="button" onclick={() => (showAll = true)}>Every shortest route</button>
            {/if}
          {/if}
          <p class="fresh">My map of Wikipedia's links is from {mapDateText}.</p>
        </div>
      </section>
    {/if}
  </main>
{/if}

<Footer />

<style>
  .top {
    max-width: 1180px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) var(--gutter) 0;
    font-size: var(--size-20);
  }
  .result,
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px var(--gutter) 56px;
  }
  .intro {
    max-width: 760px;
  }
  .missing {
    margin: 0 0 16px;
    font: 760 var(--size-39) / 1 var(--font);
    font-stretch: var(--stretch-heading);
  }

  /* The race's number is the second thing you read: display numerals, with the time beside */
  .score {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin: 40px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  .clicks {
    font-size: var(--size-25);
    font-weight: 600;
  }
  .num {
    font-size: var(--size-61);
    font-weight: 800;
    font-stretch: var(--stretch-display);
    line-height: 0.9;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .time {
    font-size: var(--size-25);
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .lede {
    max-width: 52ch;
    margin: 16px 0 0;
    color: var(--ink-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 28px;
  }
  .hint {
    margin: 12px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 22px;
    border-radius: 999px;
    font: 600 var(--size-16) / 1 var(--font);
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    min-height: 52px;
    border: 0;
    background: var(--signal);
    color: var(--on-signal);
  }
  .secondary {
    border: 1px solid var(--line);
    background: var(--bg-sunk);
    color: var(--ink);
  }
  .pill:active {
    transform: translateY(1px);
  }
  @media (max-width: 599px) {
    .actions .pill {
      flex: 1 1 100%;
    }
  }

  /* The reveal: the void canvas takes over the screen, then settles into the result */
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
    z-index: 10;
    aspect-ratio: auto;
    border-radius: 0;
    height: 100dvh;
    cursor: pointer;
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
    .result.open {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 48px;
    }
    .result.open .intro {
      grid-column: 1 / -1;
    }
    .reveal {
      grid-column: 1 / -1;
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

  @media (prefers-reduced-motion: reduce) {
    .par-num {
      animation: none;
    }
  }
</style>
