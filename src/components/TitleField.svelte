<script lang="ts" module>
  export interface Picked {
    // URL form (underscores)
    title: string;
    description: string | null;
    state: 'checking' | 'ok' | 'error';
    // why the article can't be used (state 'error'), or a note that it can ('ok')
    message?: string;
  }
</script>

<script lang="ts">
  // One end of a course: an ARIA 1.2 combobox over Wikipedia's title search (my index answers when
  // that search is busy). A picked article locks into a card with a clear button.
  import { displayTitle } from '../data/share';
  import { searchTitles, type Suggestion } from '../wiki/search';

  let {
    role,
    picked = $bindable(null),
    onpick,
    fallback,
  }: {
    role: 'start' | 'finish';
    picked?: Picked | null;
    onpick: (s: Suggestion) => void;
    // prefix matches from my title index
    fallback: (q: string) => Promise<Suggestion[]>;
  } = $props();

  const label = $derived(role === 'start' ? 'Start' : 'Finish');
  const uid = Math.random().toString(36).slice(2, 8);
  const listId = `list-${uid}`;

  let query = $state('');
  let options = $state<Suggestion[]>([]);
  let active = $state(-1);
  let expanded = $state(false);
  let fromIndex = $state(false);
  let input = $state<HTMLInputElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | null = null;

  function oninput() {
    clearTimeout(timer);
    abort?.abort();
    const q = query.trim();
    if (q.length < 2) {
      options = [];
      expanded = false;
      return;
    }
    timer = setTimeout(() => void suggest(q), 150);
  }

  async function suggest(q: string) {
    abort = new AbortController();
    const { signal } = abort;
    let list: Suggestion[];
    let indexed = false;
    try {
      list = await searchTitles(q, signal);
    } catch {
      if (signal.aborted) return;
      indexed = true;
      list = await fallback(q).catch(() => []);
    }
    if (signal.aborted || q !== query.trim()) return;
    options = list;
    fromIndex = indexed;
    active = -1;
    expanded = list.length > 0;
  }

  function pick(s: Suggestion) {
    abort?.abort();
    clearTimeout(timer);
    expanded = false;
    options = [];
    query = '';
    onpick(s);
  }

  function clear() {
    picked = null;
    queueMicrotask(() => input?.focus());
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      expanded = true;
      const n = options.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0) {
        e.preventDefault();
        pick(options[active]!);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (expanded) expanded = false;
      else query = '';
    }
  }
</script>

<div class="field {role}">
  <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
    {#if role === 'start'}<circle cx="10" cy="10" r="6" />{:else}<circle cx="10" cy="10" r="7" /><circle class="core" cx="10" cy="10" r="3.5" />{/if}
  </svg>
  {#if picked}
    <div class="card" class:error={picked.state === 'error'}>
      <span class="sr">{label}: </span>
      <span class="title">{displayTitle(picked.title)}</span>
      {#if picked.description}<span class="desc">{picked.description}</span>{/if}
      <button class="clear hover-fill" type="button" aria-label="Clear {label.toLowerCase()}" onclick={clear}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
    </div>
  {:else}
    <input
      bind:this={input}
      bind:value={query}
      type="text"
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
      placeholder={label}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
      {oninput}
      {onkeydown}
      onblur={() => setTimeout(() => (expanded = false), 150)}
    />
    <ul id={listId} role="listbox" aria-label="{label} suggestions" hidden={!expanded}>
      {#each options as o, i (o.title)}
        <!-- the keyboard stays in the combobox (arrows and Enter), as ARIA 1.2 has it -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id="{listId}-{i}" role="option" aria-selected={i === active} class:active={i === active} onpointerdown={(e) => e.preventDefault()} onclick={() => pick(o)}>
          <span class="title">{displayTitle(o.title)}</span>
          {#if o.via}<span class="desc">from “{o.via}”</span>{:else if o.description}<span class="desc">{o.description}</span>{/if}
        </li>
      {/each}
      {#if fromIndex}<li class="note" role="presentation">Suggestions from my index while Wikipedia's search is busy.</li>{/if}
    </ul>
  {/if}
  {#if picked?.state === 'checking'}
    <p class="msg">Checking my map…</p>
  {:else if picked?.message}
    <p class="msg" class:bad={picked.state === 'error'}>{picked.message}</p>
  {/if}
</div>

<style>
  .field {
    position: relative;
    padding-left: 30px;
  }
  .mark {
    position: absolute;
    left: 0;
    top: 14px;
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
  input {
    width: 100%;
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    font: 500 var(--size-16) / 1.2 var(--font);
  }
  input::placeholder {
    color: var(--ink-2);
  }
  input:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 0;
    border-color: transparent;
  }
  [role='listbox'] {
    position: absolute;
    z-index: 5;
    left: 30px;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 6px;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: var(--shadow-sheet);
  }
  [role='listbox'][hidden] {
    display: none;
  }
  [role='option'] {
    display: grid;
    min-height: 44px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  [role='option'].active,
  [role='option']:hover {
    background: var(--bg-sunk);
  }
  .title {
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .desc {
    color: var(--ink-2);
    font-size: var(--size-13);
    line-height: 1.35;
  }
  .note {
    padding: 8px 10px 4px;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .card {
    position: relative;
    display: grid;
    min-height: 48px;
    padding: 10px 52px 10px 14px;
    border-radius: 12px;
    background: var(--bg-sunk);
  }
  .card.error {
    box-shadow: inset 0 0 0 1px var(--flare);
  }
  .clear {
    position: absolute;
    top: 2px;
    right: 2px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink-2);
    cursor: pointer;
  }
  .clear svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }
  .msg {
    margin: 6px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    line-height: 1.4;
  }
  .msg.bad {
    color: var(--ink);
  }
</style>
