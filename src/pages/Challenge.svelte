<script lang="ts">
  // A challenge: the course and its table. Before you've played, nicknames, clicks and times (a
  // target to beat); after, every route. Race it opens the race with the code attached.
  import { onDestroy } from 'svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
  import CourseHero from '../components/CourseHero.svelte';
  import Footer from '../components/Footer.svelte';
  import ResultsTable, { type ResultRow } from '../components/ResultsTable.svelte';
  import ShareButton from '../components/ShareButton.svelte';
  import { normaliseCode, showCode } from '../../worker/names';
  import { displayTitle } from '../data/share';
  import { RoomApiError, getCourse, restingText, seatFor, type ChallengeTable } from '../room/api';
  import { SearchClient, supported } from '../search/client';

  const code = normaliseCode(new URLSearchParams(location.search).get('c') ?? '');
  let info = $state<(ChallengeTable & { from: string; to: string }) | null>(null);
  let problem = $state<string | null>(code ? null : 'This challenge link is incomplete.');
  let missing = $state<(number[] | null | false)[]>([]);
  let client: SearchClient | null = null;

  const rows = $derived<ResultRow[]>((info?.rows ?? []).map((r, i) => ({ ...r, missing: r.route ? (missing[i] ?? null) : undefined })));
  const raceHref = $derived(info && code ? `/race/?${new URLSearchParams({ from: info.from, to: info.to, ch: code })}` : '/');
  const link = code ? `${location.origin}/challenge/?c=${code}` : '';

  async function load() {
    if (!code) return;
    try {
      const c = await getCourse(code, seatFor(code));
      if (c.mode === 'live') {
        location.replace(`/room/?c=${code}`);
        return;
      }
      info = c;
      // routes are visible only to someone who has played: check them against my map
      if (c.played && supported()) {
        client ??= new SearchClient();
        missing = c.rows.map(() => null);
        missing = await client.check(c.rows.map((r) => r.route ?? [])).catch((e: unknown) => (console.error(e), c.rows.map(() => false as const)));
      }
    } catch (e) {
      const k = e instanceof RoomApiError ? e.code : 'server';
      problem = k === 'expired' ? 'This challenge has expired. Start a new one from any course.' : k === 'resting' ? restingText() : "Couldn't reach the challenge. Check your connection and try again.";
    }
  }
  void load();
  onDestroy(() => client?.terminate());
</script>

<SiteHeader plain />

{#if problem}
  <main class="page" id="main">
    <h1 class="missing">{problem}</h1>
    <div class="actions">
      {#if problem.startsWith("Couldn't")}<button class="pill primary" type="button" onclick={() => ((problem = null), load())}>Try again</button>{/if}
      <a class="pill secondary" href="/">Go to the home page</a>
    </div>
  </main>
{:else if !info}
  <main class="page" id="main"><p class="loading">Loading the challenge…</p></main>
{:else}
  <main class="ch" id="main">
    <p class="kicker">Challenge</p>
    <CourseHero from={info.from} to={info.to} />
    <section class="table">
      {#if rows.length}
        <ResultsTable {rows} caption={info.played ? 'Results (tap a name for the route)' : 'Results so far: the times to beat'} />
      {:else}
        <p class="empty">No results yet. Be the first.</p>
      {/if}
      {#if info.full && !info.played}
        <p class="note">This challenge already has 4 results. Race it anyway: your result still counts for you.</p>
      {/if}
    </section>
    <div class="actions">
      {#if !info.played}<a class="pill primary" href={raceHref}>Race it</a>{/if}
      <a class="pill secondary" href="/">Pick another course</a>
    </div>
    <section class="invite" aria-label="Invite">
      <p class="label">Challenge code</p>
      <p class="code">{showCode(code!)}</p>
      <ShareButton text={`Beat my route on Wikiracer: ${displayTitle(info.from)} to ${displayTitle(info.to)}\n${link}`} />
    </section>
  </main>
{/if}

<Footer />

<style>
  .ch {
    max-width: 800px;
    margin: 0 auto;
    padding: 32px var(--gutter) 56px;
    display: grid;
    gap: 28px;
  }
  .kicker,
  .label {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 600;
  }
  .missing {
    margin: 0 0 24px;
    font: 760 var(--size-39) / 1.05 var(--font);
    font-stretch: var(--stretch-heading);
    text-wrap: balance;
  }
  .loading,
  .empty,
  .note {
    margin: 0;
    color: var(--ink-2);
  }
  .note {
    margin-top: 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .invite {
    display: grid;
    gap: 8px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  .code {
    margin: 0 0 8px;
    font: 800 clamp(2.4rem, 12vw, 3.4rem) / 1 var(--font);
    font-stretch: 125%;
    letter-spacing: 0.04em;
  }
  @media (max-width: 599px) {
    .actions .pill {
      flex: 1 1 100%;
    }
  }
</style>
