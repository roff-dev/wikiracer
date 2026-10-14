<script lang="ts">
  // A challenge run's result: the table, and "Add my result" with your nickname until you have.
  // Routes show once you've added yours (each checked against my map).
  import ResultsTable, { type ResultRow } from './ResultsTable.svelte';
  import { RoomApiError, addResult, getCourse, restingText, saveName, savedName, seatFor, type ChallengeTable } from '../room/api';
  import { checkName } from '../../worker/names';

  let {
    code,
    from,
    to,
    result,
    checkRoutes = null,
  }: {
    code: string;
    from: string;
    to: string;
    result: { status: 'finished' | 'gaveup'; clicks: number; timeMs: number; route: string[] };
    checkRoutes?: ((routes: string[][]) => Promise<number[][]>) | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const seat = seatFor(code);
  let table = $state<ChallengeTable | null>(null);
  let problem = $state('');
  let name = $state(savedName());
  let busy = $state(false);
  let missing = $state<(number[] | null | false)[]>([]);

  const rows = $derived<ResultRow[]>((table?.rows ?? []).map((r, i) => ({ ...r, missing: r.route ? (missing[i] ?? null) : undefined })));

  async function check(t: ChallengeTable) {
    const routes = t.rows.map((r) => r.route ?? []);
    if (!checkRoutes || !t.played) return;
    missing = routes.map(() => null);
    missing = await checkRoutes(routes).catch((e: unknown) => (console.error(e), routes.map(() => false as const)));
  }

  function fail(e: unknown) {
    const c = e instanceof RoomApiError ? e.code : 'server';
    problem =
      c === 'expired'
        ? 'This challenge has expired. Start a new one from any course.'
        : c === 'resting'
          ? restingText()
          : c === 'full'
            ? 'This challenge already has 4 results. Your result still counts for you: share it with the link.'
            : c === 'name'
              ? 'Pick another name.'
              : c === 'exists'
                ? 'This browser already added a result. The first one counts.'
                : "Couldn't reach the challenge. Try again.";
  }

  async function load() {
    try {
      const info = await getCourse(code, seat);
      if (info.mode !== 'challenge') return;
      // the course this link names must be the one raced
      if (info.from !== from || info.to !== to) {
        problem = 'This race is a different course from the challenge.';
        return;
      }
      table = info;
      void check(info);
    } catch (e) {
      fail(e);
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const n = checkName(name);
    if (!n.ok) {
      problem = n.reason === 'blocked' ? 'Pick another name.' : 'Your nickname needs 1 to 16 letters, digits, spaces or - _ . \'';
      return;
    }
    busy = true;
    problem = '';
    try {
      table = await addResult(code, seat, { name: n.name, ...result });
      saveName(n.name);
      void check(table);
    } catch (err) {
      fail(err);
      if (err instanceof RoomApiError && (err.code === 'full' || err.code === 'exists')) void load();
    } finally {
      busy = false;
    }
  }

  void load();
</script>

<section class="challenge" aria-labelledby="ch-head">
  <h3 id="ch-head">The challenge</h3>
  {#if table && !table.played && !table.full}
    <form class="add" onsubmit={add}>
      <label>
        <span>Your nickname</span>
        <input type="text" bind:value={name} maxlength="32" autocomplete="nickname" required />
      </label>
      <button class="pill primary" type="submit" disabled={busy}>Add my result</button>
    </form>
  {/if}
  {#if table?.full && !table.played}
    <p class="problem">This challenge already has 4 results. Your result still counts for you: share it with the link.</p>
  {/if}
  {#if problem && !(table?.full && !table.played)}<p class="problem" role="alert">{problem}</p>{/if}
  {#if table}
    {#if rows.length}
      <ResultsTable {rows} caption={table.played ? 'Results (tap a name for the route)' : 'Results so far'} />
    {:else}
      <p class="empty">No results yet. Be the first.</p>
    {/if}
  {/if}
</section>

<style>
  .challenge {
    display: grid;
    gap: 14px;
    margin-top: 28px;
  }
  h3 {
    margin: 0;
    font-size: var(--size-16);
    font-weight: 600;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 12px;
  }
  label {
    display: grid;
    flex: 1 1 200px;
    gap: 6px;
    font-size: var(--size-13);
    color: var(--ink-2);
  }
  input {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    font: 500 var(--size-16) / 1.2 var(--font);
  }
  .problem,
  .empty {
    margin: 0;
  }
  .empty {
    color: var(--ink-2);
  }
</style>
