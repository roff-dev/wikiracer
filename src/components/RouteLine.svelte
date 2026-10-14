<script lang="ts">
  // A route as a transit line: the start dot, a stop per
  // article, the finish marker. `checks` holds, per hop, whether today's Wikipedia still has the
  // link (null: not checked); `missing` marks hops my map doesn't have. An `open` route stops
  // short of the finish (a race given up), so its last stop is a plain one.
  import { displayTitle } from '../data/share';
  import { mapDateText } from '../site';

  let {
    titles,
    checks = null,
    missing = [],
    onAnother = null,
    open = false,
  }: {
    titles: string[];
    checks?: (boolean | null)[] | null;
    missing?: number[];
    onAnother?: (() => void) | null;
    open?: boolean;
  } = $props();
</script>

<ol class="line">
  {#each titles as t, i (i)}
    <li class:start={i === 0} class:finish={i === titles.length - 1 && !open} class:last={i === titles.length - 1}>
      <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
        {#if i === titles.length - 1 && !open}<circle cx="10" cy="10" r="7.5" /><circle class="core" cx="10" cy="10" r="3.5" />{:else}<circle cx="10" cy="10" r="5.5" />{/if}
      </svg>
      <span class="title">{displayTitle(t)}</span>
      {#if i < titles.length - 1}
        {#if missing.includes(i)}
          <span class="note">My map doesn't have this link (added after {mapDateText}, or not clickable).</span>
        {:else if checks?.[i] === false}
          <span class="note warn">This link was removed after {mapDateText}.
            {#if onAnother}<button class="text" type="button" onclick={onAnother}>Show another shortest route</button>{/if}
          </span>
        {/if}
      {/if}
    </li>
  {/each}
</ol>

<style>
  .line {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    position: relative;
    display: grid;
    padding: 0 0 14px 30px;
    min-height: 34px;
  }
  /* the leg to the next stop */
  li:not(.last)::before {
    content: '';
    position: absolute;
    left: 8.5px;
    top: 12px;
    bottom: -10px;
    width: 3px;
    border-radius: 2px;
    background: var(--ink);
  }
  .mark {
    position: absolute;
    left: 0;
    top: 1px;
    width: 20px;
    height: 20px;
  }
  .mark circle {
    fill: var(--bg);
    stroke: var(--ink);
    stroke-width: 3px;
  }
  .start .mark circle {
    fill: var(--signal);
    stroke: var(--signal);
    stroke-width: 2px;
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
  .title {
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .note {
    margin-top: 2px;
    color: var(--ink-2);
    font-size: var(--size-13);
    line-height: 1.4;
  }
  .warn {
    color: var(--ink);
  }
  .text {
    padding: 0;
    border: 0;
    background: none;
    color: var(--signal);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
</style>
