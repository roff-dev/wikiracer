<script lang="ts">
  // Every shortest route (spec §3.3): the DAG as columns by distance, every article a chip.
  // Tapping a stop in between filters to the routes through it. Titles load 24 per column at
  // first, more as a column's end scrolls into view.
  import { SvelteMap } from 'svelte/reactivity';
  import { displayTitle, plural } from '../data/share';
  import { columns, throughNode } from '../search/dag';
  import type { Dag } from '../search/protocol';

  let { dag, loadTitles }: { dag: Dag; loadTitles: (ids: number[]) => Promise<string[]> } = $props();

  const CAP = 200;
  const STEP = 24;
  const cols = $derived(columns(dag));
  const titles = new SvelteMap<number, string>();
  let shown = $state<number[]>([]);
  let via = $state<number | null>(null);
  let failed = $state(false);
  const filter = $derived(via === null ? null : throughNode(dag, via));
  const last = $derived(cols.length - 1);

  async function load(col: number, upTo: number) {
    const want = cols[col]!.nodes.slice(0, Math.min(upTo, CAP)).filter((i) => !titles.has(i));
    if (!want.length) return;
    try {
      const got = await loadTitles(want.map((i) => dag.ids[i]!));
      want.forEach((n, k) => titles.set(n, got[k]!));
    } catch {
      failed = true;
    }
  }

  $effect(() => {
    shown = cols.map(() => STEP);
    cols.forEach((_, c) => void load(c, STEP));
  });

  function more(node: HTMLElement, col: number) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && shown[col]! < Math.min(CAP, cols[col]!.nodes.length)) {
        shown[col] = shown[col]! + STEP;
        void load(col, shown[col]!);
      }
    });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  const visible = (col: number) => {
    const nodes = cols[col]!.nodes;
    return (filter ? nodes.filter((n) => filter.has(n)) : nodes).slice(0, filter ? CAP : shown[col]);
  };
  const total = (col: number) => (filter ? cols[col]!.nodes.filter((n) => filter.has(n)).length : cols[col]!.nodes.length);
</script>

<div class="all">
  {#if via !== null}
    <p class="filter" aria-live="polite">
      {plural(dag.through[via]!, 'shortest route')} through {displayTitle(titles.get(via) ?? '…')}.
      <button type="button" class="text" onclick={() => (via = null)}>Show every route</button>
    </p>
  {/if}
  {#if failed}<p class="filter">Some titles couldn't load. Check your connection.</p>{/if}
  <div class="cols">
    {#each cols as _, c (c)}
      <section class="col" aria-label={c === 0 ? 'Start' : c === last ? 'Finish' : `After ${plural(c, 'click')}`}>
        <h3>{c === 0 ? 'Start' : c === last ? 'Finish' : `Click ${c}`}</h3>
        <ul>
          {#each visible(c) as n (n)}
            <li>
              {#if c === 0 || c === last}
                <span class="chip end" class:finish={c === last}>{displayTitle(titles.get(n) ?? '…')}</span>
              {:else}
                <button type="button" class="chip" aria-pressed={via === n} onclick={() => (via = via === n ? null : n)}>
                  {displayTitle(titles.get(n) ?? '…')}<span class="count">{dag.through[n]!.toLocaleString('en-GB')}</span>
                </button>
              {/if}
            </li>
          {/each}
          {#if !filter && shown[c]! < Math.min(CAP, total(c))}<li class="sentinel" use:more={c}></li>{/if}
        </ul>
        {#if total(c) > CAP && (filter || shown[c]! >= CAP)}
          <p class="more">and {(total(c) - CAP).toLocaleString('en-GB')} more</p>
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .cols {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(180px, 1fr);
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 8px;
    scroll-snap-type: x proximity;
  }
  .col {
    scroll-snap-align: start;
    min-width: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-size: var(--size-13);
    font-weight: 600;
    color: var(--ink-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 420px;
    overflow-y: auto;
  }
  .chip {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 10px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font: 500 var(--size-13) / 1.3 var(--font);
    font-stretch: var(--stretch-data);
    text-align: left;
    overflow-wrap: anywhere;
  }
  button.chip {
    cursor: pointer;
  }
  button.chip[aria-pressed='true'] {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .chip.end {
    border-color: var(--signal);
  }
  .chip.end.finish {
    border-color: var(--flare);
  }
  .count {
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .more,
  .filter {
    margin: 8px 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .sentinel {
    height: 1px;
  }
  .text {
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--signal);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
