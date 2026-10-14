<script lang="ts">
  // What you see at the finish: the reveal on loop, replaying demo.json. The renderer and the
  // replay load only once the canvas is on screen and the page is idle, so they never hold up the
  // home page. Under reduced motion it shows the final frame and stays there.
  import { onDestroy } from 'svelte';
  import type { Label, RevealDirector } from '../map/reveal';
  import type { Demo } from '../map/demo';
  import { displayTitle, plural } from '../data/share';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PAUSE_MS = 3500;

  let box = $state<HTMLElement>();
  let canvas = $state<HTMLCanvasElement>();
  let demo = $state<Demo | null>(null);
  let labels = $state<Label[]>([]);
  let settled = $state(false);
  let failed = $state(false);
  // a new canvas each loop: the old context is released with its director
  let round = $state(0);

  let director: RevealDirector | null = null;
  let mod: typeof import('../map/reveal') | null = null;
  let tier: import('../map/tiers').Tier;
  let visible = false;
  let waiting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dead = false;

  async function load() {
    try {
      const [m, r, tiers, d] = await Promise.all([import('../map/reveal'), import('../map/renderer'), import('../map/tiers'), import('../map/demo').then((x) => x.loadDemo())]);
      if (dead) return;
      if (!r.MapRenderer.supported()) return void (failed = true);
      mod = m;
      tier = tiers.startTier();
      demo = d;
      play();
    } catch {
      // the demo is decoration: without it, its caption says what it would show
      failed = true;
    }
  }
  // canvas is bound after the {#key} block renders, so play waits a frame
  function play() {
    requestAnimationFrame(() => {
      if (dead || !mod || !demo || !canvas) return;
      labels = [];
      settled = false;
      director = new mod.RevealDirector(canvas, {
        tier,
        reducedMotion,
        onBeat: (b) => {
          if (b !== 'settled') return;
          settled = true;
          if (!reducedMotion) {
            waiting = true;
            timer = setTimeout(next, PAUSE_MS);
          }
        },
        onLabels: (l) => (labels = l),
        onFallback: () => (failed = true),
      });
      director.addBuffered(demo.batches);
      director.finale(demo.dag, demo.routeIds, demo.route.map(displayTitle), null);
      if (reducedMotion) director.skip();
    });
  }

  // the next round starts only while the canvas is on screen and the tab is showing
  function next() {
    if (!visible || document.hidden) return;
    waiting = false;
    director?.destroy();
    director = null;
    round++;
    play();
  }

  let started = false;
  const observer = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible && !started) {
      started = true;
      const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
      idle(() => void load());
    } else if (visible && waiting) next();
  });
  const onVisibility = () => !document.hidden && visible && waiting && next();
  document.addEventListener('visibilitychange', onVisibility);

  $effect(() => {
    if (box) observer.observe(box);
  });

  onDestroy(() => {
    dead = true;
    clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    director?.destroy();
  });

  const pair = $derived(demo ? `${displayTitle(demo.start)} to ${displayTitle(demo.finish)}` : '');
  const alt = $derived(demo ? `A replay of the search for ${pair}: two fronts spread from each end until they meet, then the shortest route draws itself, ${plural(demo.d, 'click')}, through ${demo.route.slice(1, -1).map(displayTitle).join(', ')}.` : 'A replay of the search at the end of a race.');
</script>

<figure class="demo" bind:this={box}>
  <div class="stage" role="img" aria-label={alt}>
    {#if !failed}
      {#key round}<canvas bind:this={canvas} aria-hidden="true"></canvas>{/key}
      <div class="labels" aria-hidden="true">
        {#each labels as l, i (i)}
          {#if !l.hidden}<span class="label" style:transform="translate({l.x}px, {l.y}px)">{l.text}</span>{/if}
        {/each}
      </div>
    {/if}
    <p class="note" aria-hidden="true">
      {#if failed}{alt}{:else if settled && demo}Shortest route: {plural(demo.d, 'click')}{:else if demo}Searching from both ends{/if}
    </p>
  </div>
  <figcaption>{demo ? `${pair}. ` : ''}At the end of every race, my map finds every shortest route and draws it next to yours.</figcaption>
</figure>

<style>
  .demo {
    margin: 0;
  }
  .stage {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 20px;
    background: var(--void);
  }
  canvas {
    position: absolute;
    inset: 0;
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
  .note {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 14px;
    margin: 0;
    color: #a0a6b8;
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
    font-weight: 500;
  }
  figcaption {
    margin-top: 12px;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
    line-height: 1.45;
  }
  @media (min-width: 900px) {
    .stage {
      aspect-ratio: 4 / 3;
    }
  }
</style>
