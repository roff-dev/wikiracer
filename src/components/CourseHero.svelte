<script lang="ts">
  // The course typeset large: start above finish, joined in the left margin by the
  // brand mark drawn tall, a start dot and a finish marker on one hairline.
  import { displayTitle } from '../data/share';
  import { shortDescription } from '../wiki/summary';

  let { from, to }: { from: string; to: string } = $props();
  const descFrom = $derived(shortDescription(from));
  const descTo = $derived(shortDescription(to));
</script>

<h1 class="course">
  <span class="stop start">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>
    <span class="label">Start</span>
    <span class="title" class:long={from.length > 15}>{displayTitle(from)}</span>
    {#await descFrom then d}{#if d}<span class="desc">{d}</span>{/if}{/await}
  </span>
  <span class="sr"> to </span>
  <span class="stop finish">
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" /><circle class="core" cx="10" cy="10" r="4" /></svg>
    <span class="label">Finish</span>
    <span class="title" class:long={to.length > 15}>{displayTitle(to)}</span>
    {#await descTo then d}{#if d}<span class="desc">{d}</span>{/if}{/await}
  </span>
</h1>

<style>
  .course {
    position: relative;
    display: grid;
    gap: clamp(20px, 5vw, 36px);
    margin: 0;
    padding-left: 34px;
    container-type: inline-size;
    font: inherit;
  }
  /* the hairline between the two markers */
  .course::before {
    content: '';
    position: absolute;
    left: 9px;
    top: calc(0.5 * var(--size-display) * 0.95);
    bottom: calc(0.5 * var(--size-display) * 0.95);
    width: 2px;
    border-radius: 1px;
    background: var(--line);
  }
  .stop {
    position: relative;
    display: grid;
  }
  .mark {
    position: absolute;
    left: -34px;
    top: calc(0.5 * var(--size-display) * 0.95 - 10px);
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
    font-size: var(--size-display);
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
