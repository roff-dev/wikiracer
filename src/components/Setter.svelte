<script lang="ts">
  // Set a course: a start and a finish, each checked against my map once picked (in the map, and
  // a route can leave the start and reach the finish). No search runs before the race: it would
  // give the par away.
  import { onDestroy } from 'svelte';
  import TitleField, { type Picked } from './TitleField.svelte';
  import { displayTitle } from '../data/share';
  import { SearchClient, supported } from '../search/client';
  import { sameTitle } from '../race/state';
  import { mapDateText } from '../site';
  import { isDisambiguation, type Suggestion } from '../wiki/search';

  let start = $state<Picked | null>(null);
  let finish = $state<Picked | null>(null);
  let online = $state(navigator.onLine);

  // The worker (and its map reads) only start once someone picks or needs my index
  let client: SearchClient | null = null;
  const getClient = () => (supported() ? (client ??= new SearchClient()) : null);

  const same = $derived(!!start && !!finish && sameTitle(start.title, finish.title));
  const ready = $derived(start?.state === 'ok' && finish?.state === 'ok' && !same && online);
  const href = $derived(start && finish ? `/race/?${new URLSearchParams({ from: start.title, to: finish.title })}` : '/race/');

  async function fallback(q: string): Promise<Suggestion[]> {
    const c = getClient();
    if (!c) return [];
    return (await c.prefix(q)).map((h) => ({ title: h.title, description: null }));
  }

  async function check(s: Suggestion, role: 'start' | 'finish'): Promise<Picked> {
    let title = s.title;
    const base = { description: s.description };
    const c = getClient();
    if (c) {
      try {
        const [hit] = await c.lookup([title]);
        if (!hit)
          return { ...base, title, state: 'error', message: `This article is newer than my map of Wikipedia's links (${mapDateText}). Pick another, or check back after the next update.` };
        title = hit.title;
        const n = await c.degrees(hit.id);
        if (role === 'finish' && n.in === 0) return { ...base, title, state: 'error', message: `Nothing links to ${displayTitle(title)}, so no route can reach it.` };
        if (role === 'start' && n.out === 0) return { ...base, title, state: 'error', message: `${displayTitle(title)} doesn't link anywhere, so no route can leave it.` };
      } catch {
        // my map can't be reached: the race still runs, and its result explains
      }
    }
    const dis = await isDisambiguation(title);
    return { ...base, title, state: 'ok', ...(dis ? { message: 'This is a disambiguation page.' } : {}) };
  }

  // per field, the latest pick: a check that finishes after a newer pick or a clear is dropped
  const picks = { start: 0, finish: 0 };
  $effect(() => {
    if (!start) picks.start++;
    if (!finish) picks.finish++;
  });

  function pick(role: 'start' | 'finish', s: Suggestion) {
    const n = ++picks[role];
    const p: Picked = { title: s.title, description: s.description, state: 'checking' };
    if (role === 'start') start = p;
    else finish = p;
    void check(s, role).then((done) => {
      if (picks[role] !== n) return;
      if (role === 'start') start = done;
      else finish = done;
    });
  }

  function swap() {
    [start, finish] = [finish, start];
    // a start that can't be left may be a fine finish, and the other way round: check again
    for (const [role, p] of [['start', start], ['finish', finish]] as const) {
      if (p && p.state !== 'checking') pick(role, { title: p.title, description: p.description });
    }
  }

  const onOnline = () => (online = navigator.onLine);
  addEventListener('online', onOnline);
  addEventListener('offline', onOnline);
  onDestroy(() => {
    removeEventListener('online', onOnline);
    removeEventListener('offline', onOnline);
    client?.terminate();
  });
</script>

<form class="setter" onsubmit={(e) => (e.preventDefault(), ready && location.assign(href))}>
  <div class="ends">
    <TitleField role="start" bind:picked={start} onpick={(s) => pick('start', s)} {fallback} />
    <TitleField role="finish" bind:picked={finish} onpick={(s) => pick('finish', s)} {fallback} />
    <button class="swap" type="button" aria-label="Swap start and finish" onclick={swap} disabled={!start && !finish}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3v14M7 3L4 6M7 3l3 3M13 17V3M13 17l-3-3M13 17l3-3" /></svg>
    </button>
  </div>
  {#if !online}
    <p class="msg">You're offline. Races load articles from Wikipedia, so they need the internet.</p>
  {:else if same}
    <p class="msg">Start and finish are the same article.</p>
  {/if}
  <div class="actions">
    <button class="pill primary" type="submit" disabled={!ready}>Race it</button>
  </div>
</form>

<style>
  .setter {
    display: grid;
    gap: 16px;
  }
  .ends {
    position: relative;
    display: grid;
    gap: 12px;
    padding-right: 56px;
  }
  .swap {
    position: absolute;
    right: 0;
    top: 50%;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink);
    transform: translateY(-50%);
    cursor: pointer;
  }
  .swap:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .swap svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .msg {
    margin: 0;
    color: var(--ink);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  @media (max-width: 599px) {
    .actions .pill {
      flex: 1 1 100%;
    }
  }
</style>
