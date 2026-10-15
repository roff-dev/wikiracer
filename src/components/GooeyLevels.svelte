<script lang="ts" generics="T extends string">
  // A row of choices with a gooey highlight: an ink blob (the site's hover colour) follows the pointer (or focus) from button
  // to button. Moving, its leading edge races ahead and its trailing edge follows later, so the
  // body stretches towards the new button and snaps back; two droplets lag behind it and are
  // drawn back in. An SVG goo filter (blur, then a hard alpha threshold) melts it all into one
  // liquid shape. Layers, bottom to top: the resting pills, the goo, the labels, and the labels
  // again in the on-hover colour, cut to the body, so text over the blob always reads.
  let { options, labelledby, onpick }: { options: [T, string][]; labelledby: string; onpick: (value: T) => void } = $props();

  const filterId = `goo-${Math.random().toString(36).slice(2, 8)}`;
  let group = $state<HTMLElement>();
  let labels = $state<HTMLElement>();
  // the body's left and right insets, the droplets' centre, and which way it's travelling
  let left = $state(0);
  let right = $state(0);
  let centre = $state(0);
  let toRight = $state(true);
  let shown = $state(false);
  // set for the one frame a hidden blob is moved, so it doesn't slide over from where it last was
  let jump = $state(false);
  // the filter is on only while there's a blob to melt (and through its shrink after leaving):
  // over an empty layer, iOS WebKit draws a stray black square at the page's top-left
  let melting = $state(false);
  let settle: ReturnType<typeof setTimeout> | undefined;

  function place(b: HTMLElement) {
    toRight = b.offsetLeft >= left;
    left = b.offsetLeft;
    right = group!.clientWidth - b.offsetLeft - b.offsetWidth;
    centre = b.offsetLeft + b.offsetWidth / 2;
  }

  function move(i: number) {
    const b = labels?.children[i] as HTMLElement | undefined;
    if (!b || !group) return;
    clearTimeout(settle);
    melting = true;
    // hidden (first time, or after leaving the row): jump to this button, then grow there
    if (!shown) {
      jump = true;
      place(b);
      requestAnimationFrame(() => requestAnimationFrame(() => ((jump = false), (shown = true))));
    } else place(b);
  }

  function leave() {
    shown = false;
    clearTimeout(settle);
    settle = setTimeout(() => (melting = false), 400);
  }
</script>

<div class="goo-group" class:shown class:jump class:right={toRight} role="group" aria-labelledby={labelledby} bind:this={group} onpointerleave={leave} style:--goo-l="{left}px" style:--goo-r="{right}px" style:--goo-c="{centre}px" style:--goo-c2="{centre}px">
  <div class="rest" aria-hidden="true">
    {#each options as [value] (value)}<span></span>{/each}
  </div>
  <div class="goo" aria-hidden="true" style:filter={melting ? `url(#${filterId})` : null}>
    <span class="drop d2"></span>
    <span class="drop d1"></span>
    <span class="body"></span>
  </div>
  <div class="labels" bind:this={labels}>
    {#each options as [value, name], i (value)}
      <button class="pill" type="button" onpointerenter={() => move(i)} onfocus={() => move(i)} onblur={(e) => !labels?.contains(e.relatedTarget as Node | null) && leave()} onclick={() => onpick(value)}>{name}</button>
    {/each}
  </div>
  <div class="labels inverse" aria-hidden="true">
    {#each options as [value, name] (value)}<span class="pill" data-label={name}></span>{/each}
  </div>
  <svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
    <filter id={filterId} x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
      <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
    </filter>
  </svg>
</div>

<style>
  /* registered, so the edges themselves animate and the body and the light labels share them */
  @property --goo-l {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --goo-r {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --goo-c {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  @property --goo-c2 {
    syntax: '<length>';
    inherits: true;
    initial-value: 0px;
  }
  .goo-group {
    position: relative;
    display: grid;
    max-width: 420px;
    isolation: isolate;
    /* the leading edge is quick, the trailing one slow, so the body stretches as it travels;
       the droplets' centres are slower still */
    --lead: 0.24s cubic-bezier(0.3, 0.8, 0.35, 1);
    --tail: 0.46s cubic-bezier(0.65, 0, 0.25, 1);
    transition:
      --goo-l var(--lead),
      --goo-r var(--tail),
      --goo-c 0.56s cubic-bezier(0.6, 0, 0.2, 1),
      --goo-c2 0.7s cubic-bezier(0.6, 0, 0.2, 1);
  }
  .goo-group.right {
    transition:
      --goo-l var(--tail),
      --goo-r var(--lead),
      --goo-c 0.56s cubic-bezier(0.6, 0, 0.2, 1),
      --goo-c2 0.7s cubic-bezier(0.6, 0, 0.2, 1);
  }
  .goo-group.jump {
    transition: none;
  }
  .rest,
  .goo,
  .labels {
    grid-area: 1 / 1;
  }
  .rest,
  .labels {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .rest span {
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-sunk);
  }
  .goo {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }
  .body {
    position: absolute;
    inset: 0 var(--goo-r) 0 var(--goo-l);
    border-radius: 999px;
    background: var(--hover);
    /* nothing at rest: even a small pill can get past the filter's threshold and show as a dot */
    transform: scale(0);
    transition: transform 0.32s cubic-bezier(0.3, 0.8, 0.35, 1.2);
  }
  .shown .body {
    transform: scale(1);
  }
  /* droplets: they sit inside the body at rest and fall behind it on the way, then are drawn in */
  .drop {
    position: absolute;
    top: 50%;
    left: 0;
    width: 24px;
    height: 24px;
    margin: -12px 0 0 -12px;
    border-radius: 50%;
    background: var(--hover);
    translate: var(--goo-c) 0;
    scale: 0;
    transition: scale 0.3s;
  }
  .d2 {
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    translate: var(--goo-c2) 0;
  }
  .shown .drop {
    scale: 1;
  }
  .labels {
    position: relative;
    z-index: 2;
  }
  .labels .pill {
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    background: none;
    color: var(--ink);
  }
  .inverse {
    z-index: 3;
    pointer-events: none;
    clip-path: inset(0 var(--goo-r) 0 var(--goo-l) round 999px);
    opacity: 0;
    transition: opacity 0.2s;
  }
  /* drawn as generated text: it only ever shows over the blob (the clip), and the buttons
     underneath are the real, accessible labels */
  .inverse .pill {
    color: var(--on-hover);
    cursor: default;
  }
  .inverse .pill::after {
    content: attr(data-label);
  }
  /* the blob is this row's hover, so the buttons' own fill (base.css) stays off */
  .labels .pill::before {
    content: none;
  }
  .shown .inverse {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .goo-group,
    .goo-group.right,
    .body,
    .drop,
    .inverse {
      transition: none;
    }
  }
</style>
