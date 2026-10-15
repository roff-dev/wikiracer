<script lang="ts">
  // Every shortest route, built one step at a time: the start, the stops picked so far, then the
  // next click's choices (most routes onward first, a bar for each one's share), then the finish.
  // Picking a stop narrows the next list to the articles that follow from it; tapping a picked
  // stop goes back to that step.
  import { tick } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { displayTitle, plural } from '../data/share';
  import { stepper } from '../search/dag';
  import type { Dag } from '../search/protocol';

  let { dag, loadTitles }: { dag: Dag; loadTitles: (ids: number[]) => Promise<string[]> } = $props();

  const FIRST = 5;
  const STEP = 20;
  const steps = $derived(stepper(dag));
  const depth = $derived(Math.max(0, ...dag.pos));
  const start = $derived(dag.pos.indexOf(0));
  const finish = $derived(dag.pos.indexOf(depth));
  const titles = new SvelteMap<number, string>();
  let picked = $state<number[]>([]);
  let shown = $state(FIRST);
  let failed = $state(false);
  let pickerHead = $state<HTMLElement>();

  const last = $derived(picked.length ? picked.at(-1)! : start);
  const complete = $derived(picked.length === depth - 1);
  const options = $derived(complete ? [] : steps.next[last]!);
  const visible = $derived(options.slice(0, shown));
  const most = $derived(options.length ? steps.onward[options[0]!]! : 0);
  // a bar only says something when the choices differ
  const bars = $derived(options.length > 1 && most !== steps.onward[options.at(-1)!]);
  const total = $derived(dag.through[start]!);
  const name = (n: number) => displayTitle(titles.get(n) ?? '…');
  const routes = (n: number) => plural(steps.onward[n]!, 'route');

  async function load(nodes: number[]) {
    const want = nodes.filter((i) => !titles.has(i));
    if (!want.length) return;
    try {
      const got = await loadTitles(want.map((i) => dag.ids[i]!));
      want.forEach((n, k) => titles.set(n, got[k]!));
    } catch {
      failed = true;
    }
  }

  $effect(() => void load([start, finish, ...picked, ...visible]));

  async function pick(n: number) {
    picked = [...picked, n];
    shown = FIRST;
    await tick();
    pickerHead?.focus();
  }

  // back to the step where this stop was picked
  function change(i: number) {
    picked = picked.slice(0, i);
    shown = FIRST;
  }
</script>

<div class="all">
  <p class="sum" aria-live="polite">
    {#if complete}One of {plural(total, 'shortest route')}.
    {:else if picked.length}{routes(last)} left of {total.toLocaleString('en-GB')}.
    {:else}{plural(total, 'shortest route')}. Pick a first click.{/if}
  </p>
  {#if failed}<p class="sum">Some titles couldn't load. Check your connection.</p>{/if}
  <ol class="line">
    <li class="stop done">
      <span class="dot start" aria-hidden="true"></span>
      <div class="body">
        <span class="label">Start</span>
        <span class="title">{name(start)}</span>
      </div>
    </li>
    {#each picked as n, i (n)}
      <li class="stop done">
        <span class="dot" aria-hidden="true"></span>
        <div class="body">
          <span class="label">Click {i + 1}</span>
          <button class="title change" type="button" onclick={() => change(i)} aria-label="{name(n)}, click {i + 1}. Change it">{name(n)}</button>
        </div>
      </li>
    {/each}
    {#if !complete}
      <li class="stop open">
        <span class="dot ask" aria-hidden="true"></span>
        <div class="body">
          <h4 class="label" tabindex="-1" bind:this={pickerHead}>Click {picked.length + 1}: {plural(options.length, 'choice')}</h4>
          <ul class="choices">
            {#each visible as n (n)}
              <li>
                <button class="choice" type="button" onclick={() => pick(n)} aria-label="{name(n)}, {routes(n)}">
                  {#if bars}<span class="bar" style:width="{Math.max(4, (steps.onward[n]! / most) * 100)}%"></span>{/if}
                  <span class="name">{name(n)}</span>
                  <span class="count">{routes(n)}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if options.length > shown}
            <button class="text" type="button" onclick={() => (shown += STEP)}>Show {Math.min(STEP, options.length - shown)} more of {options.length - shown}</button>
          {/if}
        </div>
      </li>
      {#each { length: depth - 2 - picked.length } as _, k (k)}
        <li class="stop later" aria-hidden="true">
          <span class="dot ask"></span>
          <div class="body"><span class="label">Click {picked.length + 2 + k}</span></div>
        </li>
      {/each}
    {/if}
    <li class="stop">
      <span class="dot finish" aria-hidden="true"></span>
      <div class="body">
        <span class="label">Finish</span>
        <span class="title">{name(finish)}</span>
      </div>
    </li>
  </ol>
  {#if picked.length}
    <button class="text" type="button" onclick={() => change(0)}>Start over</button>
  {/if}
</div>

<style>
  .all {
    min-width: 0;
  }
  .sum {
    margin: 0 0 16px;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .line {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* a line down the page, the same as a route's */
  .stop {
    position: relative;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 12px;
    padding-bottom: 16px;
  }
  .stop::before {
    content: '';
    position: absolute;
    left: 9px;
    top: 18px;
    bottom: -2px;
    width: 2px;
    background: var(--ink);
  }
  .stop:last-child::before {
    display: none;
  }
  /* the line is only solid as far as the route is picked */
  .stop.open::before,
  .stop.later::before {
    background: repeating-linear-gradient(var(--line) 0 4px, transparent 4px 8px);
  }
  .dot {
    box-sizing: border-box;
    width: 14px;
    height: 14px;
    margin: 3px;
    border: 2px solid var(--ink);
    border-radius: 50%;
    background: var(--bg);
  }
  .dot.start {
    border: 0;
    background: var(--signal);
  }
  .dot.finish {
    border-color: var(--flare);
    box-shadow: inset 0 0 0 3px var(--bg), inset 0 0 0 10px var(--flare);
  }
  .dot.ask {
    border-style: dashed;
    border-color: var(--ink-2);
  }
  .body {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .label {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 600;
  }
  .label:focus {
    outline: none;
  }
  .label:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }
  .title {
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .change {
    justify-self: start;
    min-height: 44px;
    margin: -12px 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 650;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: var(--line);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .change:hover {
    text-decoration-color: currentColor;
  }
  .choices {
    list-style: none;
    display: grid;
    gap: 6px;
    margin: 8px 0 0;
    padding: 0;
  }
  .choice {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    color: var(--ink);
    font: 550 var(--size-14, 0.9rem) / 1.25 var(--font);
    text-align: left;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .choice:hover {
    border-color: var(--ink);
  }
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--signal) 12%, transparent);
    pointer-events: none;
  }
  .name,
  .count {
    position: relative;
  }
  .count {
    flex: none;
    color: var(--ink-2);
    font-stretch: var(--stretch-data);
    font-variant-numeric: tabular-nums;
  }
  .text {
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--signal);
    font: 600 var(--size-13) / 1 var(--font);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
