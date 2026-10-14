<script lang="ts" module>
  export interface ResultRow {
    place: number;
    name: string;
    status: string;
    clicks: number;
    timeMs: number | null;
    you?: boolean;
    // shown when the row is opened; absent until the viewer may see routes
    route?: string[];
    // hops my map doesn't have (null while checking, false if the check failed)
    missing?: number[] | null | false;
    // the route's colour on the result's map
    colour?: string;
  }
</script>

<script lang="ts">
  // A room's standings or a challenge's table: place, nickname, clicks, time. A row with a route
  // opens to show it as a line, with the check against my map.
  import RouteLine from './RouteLine.svelte';
  import { clock } from '../data/share';
  import { mapDateText } from '../site';

  let { rows, caption }: { rows: ResultRow[]; caption: string } = $props();
  let openRow = $state<number | null>(null);

  const words: Record<string, string> = { gaveup: 'Gave up', dnf: "Didn't finish", racing: 'Racing', away: 'Away', watching: 'Watching' };
  const check = (m: number[] | null | false | undefined) =>
    m === undefined ? '' : m === false ? "Couldn't check against my map." : m === null ? 'Checking against my map…' : m.length === 0 ? 'Every link checked' : `${m.length === 1 ? '1 link isn’t' : `${m.length} links aren’t`} in my map (added after ${mapDateText}, or not clickable)`;
</script>

<table class="results">
  <caption>{caption}</caption>
  <thead>
    <tr><th scope="col" class="pl"><span class="sr">Place</span></th><th scope="col">Name</th><th scope="col" class="num">Clicks</th><th scope="col" class="num">Time</th></tr>
  </thead>
  <tbody>
    {#each rows as r, i (i)}
      <tr class:you={r.you}>
        <td class="pl">{r.status === 'finished' ? r.place : ''}</td>
        <td>
          {#if r.route}
            {#if r.colour}<span class="key" style:--c={r.colour} aria-hidden="true"></span>{/if}<button class="name" type="button" aria-expanded={openRow === i} onclick={() => (openRow = openRow === i ? null : i)}>{r.name}{r.you ? ' (you)' : ''}</button>
          {:else}
            {r.name}{r.you ? ' (you)' : ''}
          {/if}
          {#if r.status !== 'finished'}<span class="status">{words[r.status] ?? r.status}</span>{/if}
        </td>
        <td class="num">{r.clicks}</td>
        <td class="num">{r.timeMs !== null && r.status === 'finished' ? clock(r.timeMs / 1000) : ''}</td>
      </tr>
      {#if r.route && openRow === i}
        <tr class="route-row">
          <td></td>
          <td colspan="3">
            <RouteLine titles={r.route} missing={r.missing || []} open={r.status !== 'finished'} />
            <p class="check">{check(r.missing)}</p>
          </td>
        </tr>
      {:else if r.route && r.missing !== undefined}
        <tr class="check-row"><td></td><td colspan="3"><p class="check">{check(r.missing)}</p></td></tr>
      {/if}
    {/each}
  </tbody>
</table>

<style>
  .results {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  caption {
    margin-bottom: 8px;
    font-weight: 600;
    text-align: left;
  }
  th {
    padding: 0 8px 6px 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 550;
    text-align: left;
  }
  td {
    padding: 10px 8px 10px 0;
    border-top: 1px solid var(--line);
    vertical-align: top;
    color: var(--ink-2);
  }
  tr.you td {
    color: var(--ink);
    font-weight: 600;
  }
  .route-row td,
  .check-row td {
    border-top: 0;
    padding-top: 0;
  }
  .pl {
    width: 2em;
  }
  .num {
    width: 4.5em;
    text-align: right;
  }
  th.num {
    text-align: right;
  }
  .name {
    min-width: 44px;
    min-height: 44px;
    text-align: left;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  /* the line's colour on the map, on the void it's drawn on */
  .key {
    display: inline-block;
    position: relative;
    width: 22px;
    height: 12px;
    margin-right: 8px;
    border-radius: 6px;
    background: var(--void);
    vertical-align: -1px;
  }
  .key::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: 4.5px;
    height: 3px;
    border-radius: 2px;
    background: var(--c);
  }
  .status {
    display: block;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 450;
  }
  .check {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .route-row :global(.line) {
    margin-top: 6px;
  }
</style>
