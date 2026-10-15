<script lang="ts">
  // The course typeset large: start above finish, joined in the left margin by the
  // brand mark drawn tall, a start dot and a finish marker on one hairline.
  import { displayTitle } from '../data/share';
  import { shortDescription } from '../wiki/summary';

  let { from, to }: { from: string; to: string } = $props();
  const descFrom = $derived(shortDescription(from));
  const descTo = $derived(shortDescription(to));
  // the runs of letters that each have to sit on one line (spaces and hyphens can break)
  const words = (t: string) => displayTitle(t).split(/[\s-]+/);
  const guess = (t: string) => Math.max(...words(t).map((w) => w.length)) * 0.7;

  // Each title's widest word, measured in em in its own type (letters differ: a W is twice an
  // i), so the size can step down until it fits rather than break mid-word. Until the font is
  // in, a guess of 0.7 em a letter.
  let course = $state<HTMLElement>();
  let fromEm = $state<number>();
  let toEm = $state<number>();
  function measure(title: HTMLElement, list: string[]) {
    const probe = title.cloneNode() as HTMLElement;
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:100px';
    title.after(probe);
    const em = Math.max(
      ...list.map((w) => {
        probe.textContent = w;
        return probe.getBoundingClientRect().width / 100;
      }),
    );
    probe.remove();
    return em;
  }
  $effect(() => {
    const el = course!;
    const [a, b] = [words(from), words(to)];
    let live = true;
    const run = () => {
      if (!live) return;
      const [ta, tb] = el.querySelectorAll<HTMLElement>('.title');
      fromEm = measure(ta!, a);
      toEm = measure(tb!, b);
    };
    // the type narrows in a small column (.long), so measure again when the column's width
    // changes, a frame later (the new size changes the height, which mustn't loop back here)
    let width = -1;
    const ro = new ResizeObserver(([e]) => {
      if (e!.contentRect.width === width) return;
      width = e!.contentRect.width;
      requestAnimationFrame(run);
    });
    void document.fonts.ready.then(() => live && ro.observe(el));
    return () => {
      live = false;
      ro.disconnect();
    };
  });
</script>

<h1 class="course" bind:this={course} style:--from-em={fromEm ?? guess(from)} style:--to-em={toEm ?? guess(to)}>
  <span class="stop start">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>
    <span class="label">Start</span>
    <span class="title" class:long={from.length > 15}>{displayTitle(from)}</span>
    {#await descFrom}<span class="desc" aria-hidden="true"></span>{:then d}{#if d}<span class="desc">{d}</span>{/if}{/await}
  </span>
  <span class="sr"> to </span>
  <span class="stop finish">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><circle class="core" cx="10" cy="10" r="4" /></svg>
    <span class="label">Finish</span>
    <span class="title" class:long={to.length > 15}>{displayTitle(to)}</span>
    {#await descTo}<span class="desc" aria-hidden="true"></span>{:then d}{#if d}<span class="desc">{d}</span>{/if}{/await}
  </span>
</h1>

<style>
  .course {
    position: relative;
    display: grid;
    --gap: clamp(20px, 5vw, 36px);
    gap: var(--gap);
    margin: 0;
    padding-left: 34px;
    container-type: inline-size;
    font: inherit;
  }
  .stop {
    /* a title whose longest word is too wide for the column steps down until it fits (with a
       hair to spare for rounding), rather than breaking mid-word */
    --size-from: min(var(--size-display), 0.98 * 100cqi / var(--from-em, 1));
    --size-to: min(var(--size-display), 0.98 * 100cqi / var(--to-em, 1));
    --mid: calc(0.5 * var(--size) * 0.95);
    position: relative;
    display: grid;
  }
  .start {
    --size: var(--size-from);
  }
  .finish {
    --size: var(--size-to);
  }
  /* the hairline between the two markers' centres, under the finish marker */
  .start::before {
    content: '';
    position: absolute;
    left: -25px;
    top: var(--mid);
    height: calc(100% - var(--mid) + var(--gap) + 0.5 * var(--size-to) * 0.95);
    width: 2px;
    border-radius: 1px;
    background: var(--line);
  }
  .mark {
    position: absolute;
    left: -34px;
    top: calc(var(--mid) - 10px);
    width: 20px;
    height: 20px;
  }
  .start .mark circle {
    fill: var(--signal);
  }
  .finish .mark circle {
    fill: var(--bg);
    stroke: var(--flare);
    stroke-width: 2.5px;
  }
  .finish .mark .core {
    fill: var(--flare);
    stroke: none;
  }
  .label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .title {
    font-size: var(--size);
    font-weight: 780;
    line-height: 0.95;
    letter-spacing: -0.02em;
    font-stretch: var(--stretch-display);
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  /* long titles step down in width before they step down in size */
  .title.long {
    font-stretch: 100%;
  }
  @container (max-width: 420px) {
    .title.long {
      font-stretch: var(--stretch-data);
    }
  }
  .desc {
    min-height: 1.4em;
    margin-top: 8px;
    color: var(--ink-2);
    font-size: var(--size-16);
    font-weight: 450;
    font-stretch: var(--stretch-ui);
    line-height: 1.4;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
