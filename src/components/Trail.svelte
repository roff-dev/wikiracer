<script lang="ts">
  // The trail: the articles visited, joined by hairline connectors (one per click), newest at the
  // end, with the finish pinned after them as a chip. A strip that scrolls sideways.
  import { tick } from 'svelte';
  import { displayTitle } from '../data/share';

  let { route, to }: { route: string[]; to: string } = $props();
  let list = $state<HTMLOListElement>();

  // the newest stop stays in view
  $effect(() => {
    void route.length;
    void tick().then(() => {
      if (!list) return;
      list.scrollTo({ left: list.scrollWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  });
</script>

<nav class="trail" aria-label="Your route so far">
  <ol bind:this={list}>
    {#each route as t, i (i)}
      <li class:start={i === 0} class:now={i === route.length - 1}>
        {#if i > 0}<svg class="joint" viewBox="0 0 16 8" aria-hidden="true"><path d="M0 4h16" /></svg>{/if}
        <span class="stop">{displayTitle(t)}</span>
      </li>
    {/each}
  </ol>
  <span class="finish"><span class="sr">Finish: </span>{displayTitle(to)}</span>
</nav>

<style>
  .trail {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 44px;
    padding: 0 0 0 var(--gutter);
    background: var(--bg-sunk);
  }
  ol {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-x: auto;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }
  ol::-webkit-scrollbar {
    display: none;
  }
  li {
    display: flex;
    align-items: center;
    flex: none;
    scroll-snap-align: end;
  }
  .joint {
    width: 16px;
    height: 8px;
    margin: 0 6px;
    stroke: var(--ink-2);
    stroke-width: 1.5;
  }
  .stop {
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 550;
    font-stretch: var(--stretch-data);
  }
  .start .stop::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--signal);
    vertical-align: 0.05em;
  }
  .now .stop {
    color: var(--ink);
  }
  .finish {
    flex: none;
    max-width: 40%;
    margin-right: var(--gutter);
    padding: 3px 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1.5px solid var(--flare);
    border-radius: 6px;
    /* on --bg, not the strip's sunk grey, so the magenta text keeps AA */
    background: var(--bg);
    color: var(--flare);
    font-size: var(--size-13);
    font-weight: 650;
    font-stretch: var(--stretch-data);
  }
</style>
