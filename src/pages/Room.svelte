<script lang="ts">
  // A live room: lobby, countdown, race, standings, then back to the lobby for the next course.
  // During a round the page is the race view (Race in room mode) plus the board, which shows each
  // player's clicks and status, never their article. The search for the shortest route starts as
  // soon as the course is set, so everyone's reveal is ready.
  import { onDestroy } from 'svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
  import CourseHero from '../components/CourseHero.svelte';
  import Footer from '../components/Footer.svelte';
  import ResultsTable, { type ResultRow } from '../components/ResultsTable.svelte';
  import Setter from '../components/Setter.svelte';
  import CopyButton from '../components/CopyButton.svelte';
  import Sheet from '../components/Sheet.svelte';
  import { normaliseCode, showCode } from '../../worker/names';
  import type { ErrorCode, PlayerState, RoomState, Scoring, StandingRow } from '../../worker/protocol';
  import { surprise, type Difficulty } from '../data/pools';
  import { clock, plural } from '../data/share';
  import { REVEAL } from '../map/renderer';
  import { startTier } from '../map/tiers';
  import { RoomApiError, getCourse, restingText, saveName, savedName, seatFor } from '../room/api';
  import { RoomSocket } from '../room/socket';
  import { SearchClient, supported } from '../search/client';
  import { SearchSession } from '../search/session';
  import Race, { type RoomRace } from './Race.svelte';

  const code = normaliseCode(new URLSearchParams(location.search).get('c') ?? '');
  const link = code ? `${location.origin}/room/?c=${code}` : '';

  type Stage = 'loading' | 'problem' | 'name' | 'connecting' | 'in' | 'left';
  let stage = $state<Stage>(code ? 'loading' : 'problem');
  let problem = $state(code ? '' : 'This room link is incomplete.');
  let name = $state(savedName());
  let nameProblem = $state('');
  let room = $state<RoomState | null>(null);
  let you = $state<number | null>(null);
  let connection = $state<'connecting' | 'open' | 'lost'>('connecting');
  let results = $state<{ round: number; rows: StandingRow[] } | null>(null);
  let missing = $state<(number[] | null | false)[]>([]);
  let session = $state.raw<SearchSession | null>(null);
  let changeOpen = $state(false);
  let picking = $state(false);
  let announce = $state('');
  let copied = $state(false);
  // the round whose race this page has shown (a reload at the standings shows the table instead)
  let shownRound = $state(0);
  // the round's start on the room's clock (the state stops carrying it once the round ends)
  let startAt = $state<number | null>(null);

  let socket = $state.raw<RoomSocket | null>(null);
  let client: SearchClient | null = null;
  let courseKey = '';

  const players = $derived(room?.players ?? []);
  const me = $derived(players.find((p) => p.n === you) ?? null);
  const host = $derived(players.find((p) => p.n === room?.host) ?? null);
  const isHost = $derived(!!room && room.host === you);
  const connected = $derived(players.filter((p) => p.status !== 'away').length);
  const inRound = $derived(!!room && (room.phase === 'countdown' || room.phase === 'race'));
  const racingHere = $derived(!!room && !!me && me.status !== 'watching' && (inRound || (room.phase === 'standings' && shownRound === room.round)));
  const SCORINGS: { value: Scoring; name: string; desc: string }[] = [
    { value: 'clicks', name: 'Shortest route', desc: 'Fewest clicks wins. Time only breaks ties.' },
    { value: 'time', name: 'Timed', desc: 'First to the finish wins. The clock runs in real time, loading included.' },
  ];
  const scoring = $derived<Scoring>(room?.scoring ?? 'clicks');
  // a timed round's first finisher (the room's clock), once someone other than you is home
  const winner = $derived.by(() => {
    if (scoring !== 'time') return null;
    const done = players.filter((p) => p.status === 'finished' && p.timeMs !== undefined).sort((a, b) => a.timeMs! - b.timeMs!);
    return done[0] && done[0].n !== you ? { name: done[0].name, timeMs: done[0].timeMs! } : null;
  });
  const stillRacing = $derived(players.filter((p) => p.n !== you && (p.status === 'racing' || p.status === 'away') && inRound));
  const rows = $derived<ResultRow[]>(
    results
      ? results.rows.map((r, i) => {
          // the same colours, in the same order, as the routes on the result's map
          const k = results!.rows.filter((x) => x.n !== you).indexOf(r);
          const colour = r.n === you ? REVEAL.players[0] : REVEAL.others[k % REVEAL.others.length];
          return { place: r.place, name: r.name, status: r.status, clicks: r.clicks, timeMs: r.timeMs, you: r.n === you, route: r.route, missing: missing[i] ?? null, colour };
        })
      : [],
  );
  const others = $derived(results ? results.rows.filter((r) => r.n !== you).map((r) => r.route) : []);

  $effect(() => {
    if (racingHere && room) shownRound = room.round;
  });

  // The course's search, started as soon as the course is set; a new course cancels the old one
  function searchFor(from: string, to: string) {
    const key = `${from}|${to}`;
    if (key === courseKey || !supported()) return;
    courseKey = key;
    session?.cancel();
    client ??= new SearchClient();
    session = new SearchSession(client, from, to, startTier().drawBudget);
    void session.start();
  }

  function apply(next: RoomState) {
    const before = room;
    // other players finishing are announced; their click counts aren't (too chatty)
    if (before && before.round === next.round) {
      for (const p of next.players) {
        const was = before.players.find((q) => q.n === p.n);
        if (p.n !== you && p.status === 'finished' && was?.status !== 'finished') announce = `${p.name} finished in ${plural(p.clicks, 'click')}.`;
      }
    }
    if (next.round !== before?.round && next.phase === 'countdown') socket?.newRound();
    if (next.phase === 'lobby') results = null;
    if (next.startAt !== undefined) startAt = next.startAt;
    else if (next.phase === 'lobby') startAt = null;
    room = next;
    searchFor(next.from, next.to);
  }

  async function checkRoutes(r: StandingRow[]) {
    missing = r.map(() => null);
    if (!client) return;
    missing = await client.check(r.map((x) => x.route)).catch((e: unknown) => (console.error(e), r.map(() => false as const)));
  }

  function onError(c: ErrorCode) {
    if (c === 'full') {
      stage = 'problem';
      problem = 'This room is full (4 players).';
    } else if (c === 'name') {
      stage = 'name';
      nameProblem = 'Pick another name.';
      socket?.close();
    } else if (c === 'expired') {
      stage = 'problem';
      problem = 'This room has expired. Start a new one from any course.';
    } else if (c === 'rate') {
      announce = 'Too many messages at once, so this race counts as given up.';
    }
  }

  function join(e?: SubmitEvent) {
    e?.preventDefault();
    if (!code) return;
    nameProblem = '';
    saveName(name.trim());
    stage = 'connecting';
    socket?.close();
    socket = new RoomSocket(code, seatFor(code), name.trim(), {
      welcome: (n, st) => {
        you = n;
        stage = 'in';
        apply(st);
      },
      state: apply,
      standings: (round, r) => {
        results = { round, rows: r };
        void checkRoutes(r);
      },
      error: onError,
      connection: (c) => (connection = c),
    });
    socket.connect();
  }

  async function open() {
    if (!code) return;
    try {
      const info = await getCourse(code, seatFor(code));
      if (info.mode === 'challenge') {
        location.replace(`/challenge/?c=${code}`);
        return;
      }
      searchFor(info.from, info.to);
      if (name.trim()) join();
      else stage = 'name';
    } catch (e) {
      const k = e instanceof RoomApiError ? e.code : 'server';
      stage = 'problem';
      problem = k === 'expired' ? 'This room has expired. Start a new one from any course.' : k === 'resting' ? restingText() : "Couldn't reach the room. Check your connection and try again.";
    }
  }

  function setCourse(from: string, to: string) {
    socket?.send({ t: 'course', from, to });
    changeOpen = false;
  }

  async function surpriseMe(level: Difficulty) {
    picking = true;
    try {
      const c = await surprise(level);
      setCourse(c.from, c.to);
    } catch {
      announce = "Couldn't load the courses. Try again.";
    } finally {
      picking = false;
    }
  }

  function leave() {
    socket?.leave();
    stage = 'left';
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code!);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // the code is on screen to type
    }
  }

  const statusWord = (p: PlayerState) =>
    ({ waiting: 'Here', racing: 'Racing', finished: p.timeMs !== undefined ? `Finished in ${clock(p.timeMs / 1000)}` : 'Finished', gaveup: 'Gave up', dnf: "Didn't finish", watching: 'Watching', away: 'Away' })[p.status];

  const roomRace = $derived<RoomRace | null>(
    room && startAt !== null && socket
      ? {
          from: room.from,
          to: room.to,
          key: `${code}.${room.round}`,
          startAt: socket.local(startAt),
          scoring,
          winner,
          myTimeMs: me?.timeMs ?? null,
          session,
          onmove: (clicks, title) => socket?.send({ t: 'move', click: clicks, title }),
          onfinish: (clicks, timeMs, route) => socket?.send({ t: 'finish', clicks, timeMs, route }),
          ongiveup: (clicks) => socket?.send({ t: 'giveup', clicks }),
          onleave: leave,
          board,
          table,
          others,
        }
      : null,
  );

  void open();
  onDestroy(() => {
    socket?.close();
    session?.cancel();
    client?.terminate();
  });
</script>

{#snippet board()}
  <details class="board-bar">
    <summary>
      <span class="sr">Players: </span>
      {#each players as p (p.n)}
        <span class="entry" class:me={p.n === you}>
          <span class="no">{p.n}</span>
          <span class="who">{p.name}</span>
          <span class="count">{p.clicks}</span>
          {#if p.status === 'finished'}<svg class="done" viewBox="0 0 20 20" aria-label="finished"><circle cx="10" cy="10" r="7" /><circle class="core" cx="10" cy="10" r="3.5" /></svg>{/if}
        </span>
      {/each}
    </summary>
    {@render boardList()}
  </details>
{/snippet}

{#snippet boardList()}
  <ol class="board" role="list">
    {#each players as p (p.n)}
      <li class:me={p.n === you}>
        <span class="no">{p.n}</span>
        <span class="who">{p.name}{p.n === you ? ' (you)' : ''}</span>
        <span class="count">{plural(p.clicks, 'click')}</span>
        <span class="st">{statusWord(p)}</span>
      </li>
    {/each}
  </ol>
{/snippet}

{#snippet table()}
  <section class="room-table">
    {#if results}
      <ResultsTable {rows} caption="This room (tap a name for the route)" />
    {:else}
      <h3 class="tt">This room</h3>
      {@render boardList()}
      {#if stillRacing.length}
        <p class="waiting">Waiting for {stillRacing.map((p) => p.name).join(stillRacing.length === 2 ? ' and ' : ', ').replace(/, ([^,]*)$/, ' and $1')}.</p>
      {/if}
    {/if}
    <div class="room-actions">
      {#if results && isHost}<button class="pill primary" type="button" onclick={() => (changeOpen = true)}>Next course</button>{/if}
      {#if results && !isHost}<p class="waiting">Waiting for {host?.name ?? 'the host'} to pick the next course.</p>{/if}
      <button class="pill secondary" type="button" onclick={leave}>Leave room</button>
    </div>
  </section>
{/snippet}

<p class="sr" aria-live="polite">{announce}</p>

{#if stage !== 'left' && racingHere && roomRace}
  {#key room!.round}
    <Race room={roomRace} />
  {/key}
  {#if connection === 'lost'}<p class="lost" role="status">Reconnecting to the room…</p>{/if}
{:else}
  <SiteHeader plain />
  <main class="room" id="main">
    {#if stage === 'problem'}
      <h1 class="missing">{problem}</h1>
      <div class="actions">
        {#if problem.startsWith("Couldn't")}<button class="pill primary" type="button" onclick={() => ((stage = 'loading'), open())}>Try again</button>{/if}
        <a class="pill secondary" href="/">Go to the home page</a>
      </div>
    {:else if stage === 'left'}
      <h1 class="missing">You left the room.</h1>
      <div class="actions">
        <button class="pill primary" type="button" onclick={() => join()}>Join again</button>
        <a class="pill secondary" href="/">Go to the home page</a>
      </div>
    {:else if stage === 'loading' || stage === 'connecting'}
      <p class="quiet">Joining room {code ? showCode(code) : ''}…</p>
    {:else if stage === 'name'}
      <h1 class="missing">Join room {showCode(code!)}</h1>
      <form class="name-form" onsubmit={join}>
        <label>
          <span>Your nickname</span>
          <input type="text" bind:value={name} maxlength="32" autocomplete="nickname" required />
        </label>
        {#if nameProblem}<p role="alert">{nameProblem}</p>{/if}
        <button class="pill primary" type="submit">Join</button>
      </form>
    {:else if room}
      <section class="invite" aria-label="Invitation">
        <p class="label">Room code</p>
        <div class="code-row">
          <button class="code" type="button" onclick={copyCode} aria-label="Room code {code!.split('').join(' ')}, tap to copy">{showCode(code!)}</button>
          <CopyButton bare text={code!} label="Copy the code" />
        </div>
        <p class="hint" aria-live="polite">{copied ? 'Code copied.' : 'Tap the code to copy it. Friends join with the code or the link.'}</p>
        <div class="link-row">
          <p class="link">{link}</p>
          <CopyButton text={link} label="Copy the link" />
        </div>
      </section>

      <section class="course">
        <CourseHero from={room.from} to={room.to} />
      </section>

      {#if room.phase === 'standings' && results}
        {@render table()}
      {:else}
        <section class="players" aria-labelledby="players-head">
          <h2 id="players-head">Players</h2>
          <ol class="seats" role="list">
            {#each [1, 2, 3, 4] as n (n)}
              {@const p = players.find((x) => x.n === n)}
              <li class:me={n === you} class:empty={!p}>
                <span class="no">{n}</span>
                {#if p}
                  <span class="who">{p.name}{n === you ? ' (you)' : ''}{p.n === room.host ? ', host' : ''}</span>
                  <span class="st">{statusWord(p)}</span>
                {:else}
                  <span class="who">Waiting…</span>
                {/if}
              </li>
            {/each}
          </ol>
          {#if inRound}<p class="quiet">A race is under way. You'll be in the next one.</p>{/if}
          {#if room.phase === 'lobby'}
            {#if isHost}
              <fieldset class="scorings">
                <legend class="label">How to win</legend>
                {#each SCORINGS as s (s.value)}
                  <label class="scoring" class:on={scoring === s.value}>
                    <input type="radio" name="scoring" value={s.value} checked={scoring === s.value} onchange={() => socket?.send({ t: 'scoring', scoring: s.value })} />
                    <span class="scoring-name">{s.name}</span>
                    <span class="scoring-desc">{s.desc}</span>
                  </label>
                {/each}
              </fieldset>
            {:else}
              {@const s = SCORINGS.find((x) => x.value === scoring)!}
              <p class="scoring-line"><strong>{s.name}.</strong> {s.desc}</p>
            {/if}
          {/if}
        </section>
        {#if room.phase === 'lobby'}
          <div class="actions host">
            {#if isHost}
              <button class="pill secondary" type="button" onclick={() => (changeOpen = true)}>Change course</button>
              <button class="pill primary" type="button" disabled={connected < 2} onclick={() => socket?.send({ t: 'start' })}>Start</button>
              {#if connected < 2}<p class="quiet">Start needs at least 2 players here.</p>{/if}
            {:else}
              <p class="quiet">Waiting for {host?.name ?? 'the host'} to start.</p>
            {/if}
          </div>
        {/if}
        <button class="text" type="button" onclick={leave}>Leave room</button>
      {/if}
      {#if connection === 'lost'}<p class="lost" role="status">Reconnecting to the room…</p>{/if}
    {/if}
  </main>
  <Footer />
{/if}

<Sheet bind:open={changeOpen} title="Pick the course">
  <div class="change">
    <p class="label">Surprise me</p>
    <div class="levels">
      {#each [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] as const as [level, word] (level)}
        <button class="pill secondary" type="button" disabled={picking} onclick={() => surpriseMe(level)}>{word}</button>
      {/each}
    </div>
    <p class="label">Or set one</p>
    <Setter onuse={setCourse} />
  </div>
</Sheet>

<style>
  .room {
    display: grid;
    gap: 32px;
    max-width: 1240px;
    margin: 0 auto;
    padding: 32px var(--gutter) 56px;
  }
  .missing {
    margin: 0;
    font: 760 var(--size-39) / 1.05 var(--font);
    font-stretch: var(--stretch-heading);
    text-wrap: balance;
  }
  .quiet,
  .hint,
  .label {
    margin: 0;
    color: var(--ink-2);
  }
  .label {
    font-size: var(--size-13);
    font-weight: 600;
  }
  .hint {
    font-size: var(--size-13);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  /* the same choice cards as the friends sheet's live room / challenge link */
  .scorings {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 10px;
    max-width: 640px;
    margin: 24px 0 0;
    padding: 0;
    border: 0;
  }
  .scorings legend {
    margin-bottom: 8px;
    padding: 0;
  }
  .scoring {
    position: relative;
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 12px 14px 12px 44px;
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
  }
  .scoring.on {
    border-color: var(--signal);
    box-shadow: inset 0 0 0 1px var(--signal);
  }
  .scoring input {
    position: absolute;
    left: 14px;
    top: 15px;
    margin: 0;
    accent-color: var(--signal);
  }
  .scoring-name {
    font-weight: 650;
  }
  .scoring-desc {
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .scoring-line {
    margin: 20px 0 0;
    color: var(--ink-2);
  }
  .scoring-line strong {
    color: var(--ink);
    font-weight: 650;
  }
  .invite {
    display: grid;
    justify-items: start;
    gap: 8px;
  }
  /* the code and its copy icon on one line; the row carries the code's size, so the icon
     follows it */
  .code-row {
    display: flex;
    align-items: center;
    gap: 0.15em;
    font-size: clamp(2.8rem, min(15vw, 18svh), 4.75rem);
  }
  .link-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    justify-self: stretch;
    max-width: 520px;
    padding: 4px 4px 4px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunk);
  }
  .link {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    overflow-wrap: anywhere;
  }
  /* the code: Mona Sans width 125, weight 800, grouped 3 + 3 */
  .code {
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 800 1em / 1 var(--font);
    font-stretch: 125%;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .players h2 {
    margin: 0 0 12px;
    font-size: var(--size-20);
    font-weight: 680;
    font-stretch: var(--stretch-heading);
  }
  .seats,
  .board {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .seats li,
  .board li {
    display: grid;
    grid-template-columns: 2em 1fr auto;
    align-items: baseline;
    gap: 0 10px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
    color: var(--ink-2);
  }
  .board li {
    grid-template-columns: 1.6em 1fr auto;
    padding: 8px 0;
  }
  .board .st {
    grid-column: 2 / -1;
    font-size: var(--size-13);
  }
  .seats li.me,
  .board li.me {
    color: var(--ink);
    font-weight: 600;
  }
  .seats li.empty .who {
    color: var(--ink-2);
    font-style: italic;
  }
  .no {
    font-weight: 800;
    font-stretch: var(--stretch-display);
    font-variant-numeric: tabular-nums;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
  .host .pill.primary {
    min-width: 160px;
  }
  .text {
    justify-self: start;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink-2);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .name-form {
    display: grid;
    gap: 14px;
    max-width: 420px;
  }
  .name-form label {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  .name-form input {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    font: 500 var(--size-16) / 1.2 var(--font);
  }
  .change {
    display: grid;
    gap: 14px;
  }
  .levels {
    display: flex;
    gap: 10px;
  }
  .lost {
    position: fixed;
    left: 50%;
    bottom: calc(80px + env(safe-area-inset-bottom));
    z-index: 26;
    margin: 0;
    padding: 8px 14px;
    border-radius: 999px;
    background: var(--ink);
    color: var(--bg);
    font-size: var(--size-13);
    transform: translateX(-50%);
  }

  /* The board during a race: a 44 px bar under the trail (tap for the full rows) */
  .board-bar {
    border-top: 1px solid var(--line);
    background: var(--bg-sunk);
  }
  .board-bar summary {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 44px;
    padding: 0 var(--gutter);
    overflow-x: auto;
    list-style: none;
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
    cursor: pointer;
    scrollbar-width: none;
  }
  .board-bar summary::-webkit-details-marker {
    display: none;
  }
  .board-bar[open] .board {
    padding: 0 var(--gutter) 8px;
  }
  .entry {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    color: var(--ink-2);
  }
  .entry.me {
    color: var(--ink);
    font-weight: 650;
  }
  .entry .who {
    max-width: 9ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry .count {
    font-weight: 700;
  }
  /* desktop: the board sits beside the trail in one bar, and its full rows drop down over the
     article */
  @media (min-width: 1100px) {
    .board-bar {
      position: relative;
      flex: 0 1 auto;
      min-width: 0;
      margin-left: auto;
      border-top: 0;
      border-left: 1px solid var(--line);
    }
    .board-bar[open] .board {
      position: absolute;
      top: 100%;
      right: 0;
      min-width: 300px;
      padding: 0 var(--gutter) 8px;
      border: 1px solid var(--line);
      border-top: 0;
      border-radius: 0 0 12px 12px;
      background: var(--bg);
      box-shadow: var(--shadow-sheet);
    }
  }
  .done {
    width: 12px;
    height: 12px;
  }
  .done circle {
    fill: var(--bg);
    stroke: var(--flare);
    stroke-width: 2.5px;
  }
  .done .core {
    fill: var(--flare);
    stroke: none;
  }

  .room-table {
    display: grid;
    gap: 12px;
    margin-top: 24px;
  }
  .tt {
    margin: 0;
    font-size: var(--size-16);
    font-weight: 600;
  }
  .waiting {
    margin: 0;
    color: var(--ink-2);
  }
  .room-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  }

  @media (min-width: 900px) {
    .room {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: 48px;
    }
    .invite {
      grid-column: 1 / -1;
    }
  }
</style>
