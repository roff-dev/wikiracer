<script lang="ts">
  // The shared result: rebuilt from its URL. The course and the race's clicks and
  // time show at once; the routes stay behind a spoiler button, which runs the search and the
  // reveal, unless this browser has already finished the course.
  import { onDestroy } from 'svelte';
  import CourseHero from '../components/CourseHero.svelte';
  import Footer from '../components/Footer.svelte';
  import Reveal from '../components/Reveal.svelte';
  import { clicksOf, clock, displayTitle, parseResult } from '../data/share';
  import { hasFinished } from '../data/storage';
  import { startTier } from '../map/tiers';
  import { SearchClient, supported } from '../search/client';
  import { SearchSession } from '../search/session';

  const shared = parseResult(location.search);
  const route = shared ? [shared.from, ...shared.via, shared.to] : [];
  const clicks = shared ? clicksOf(shared) : 0;
  const raceHref = shared ? `/race/?${new URLSearchParams({ from: shared.from, to: shared.to })}` : '/';

  let open = $state(false);
  let takeover = $state(false);
  let session = $state.raw<SearchSession | null>(null);
  let client: SearchClient | null = null;

  function show(auto: boolean) {
    if (!shared) return;
    if (supported()) {
      client ??= new SearchClient();
      session = new SearchSession(client, shared.from, shared.to, startTier().drawBudget);
      void session.start();
    }
    takeover = !auto;
    open = true;
  }

  if (shared && hasFinished(shared.from, shared.to)) show(true);

  function leave() {
    session?.cancel();
  }
  addEventListener('pagehide', leave);
  onDestroy(() => {
    leave();
    removeEventListener('pagehide', leave);
    client?.terminate();
  });
</script>

<header class="top">
  <a class="wordmark" href="/">wikiracer</a>
</header>

{#if !shared}
  <main class="page" id="main">
    <h1 class="missing">This result link is incomplete.</h1>
    <p class="lede">It needs a start, a finish and a time. Ask for the link again, or pick a course yourself.</p>
    <a class="pill primary" href="/">Go to the home page</a>
  </main>
{:else}
  <main class="result" class:open id="main">
    <section class="intro">
      <CourseHero from={shared.from} to={shared.to} />
      <p class="score">
        <span class="clicks"><span class="num">{clicks}</span> {clicks === 1 ? 'click' : 'clicks'}</span>
        <span class="time">in {clock(shared.seconds)}</span>
      </p>
      <p class="lede">Someone raced from {displayTitle(shared.from)} to {displayTitle(shared.to)} by tapping links, and sent you their result. Fewest clicks wins.</p>
      <div class="actions">
        <a class="pill primary" href={raceHref}>Race it yourself</a>
        {#if !open}
          <button class="pill secondary" type="button" onclick={() => show(false)}>Show the routes (spoilers)</button>
        {/if}
      </div>
      {#if !open}
        <p class="hint">The routes give the course away. Race it first if you'd rather find your own.</p>
      {/if}
    </section>

    {#if open && shared}
      <Reveal {session} from={shared.from} to={shared.to} {route} {clicks} seconds={shared.seconds} voice="shared" bind:takeover />
    {/if}
  </main>
{/if}

<Footer />

<style>
  .top {
    max-width: 1180px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) var(--gutter) 0;
    font-size: var(--size-20);
  }
  .result,
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 40px var(--gutter) 56px;
  }
  .intro {
    max-width: 760px;
  }
  .missing {
    margin: 0 0 16px;
    font: 760 var(--size-39) / 1 var(--font);
    font-stretch: var(--stretch-heading);
  }

  /* The race's number is the second thing you read: display numerals, with the time beside */
  .score {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin: 40px 0 0;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  .clicks {
    font-size: var(--size-25);
    font-weight: 600;
  }
  .num {
    font-size: var(--size-61);
    font-weight: 800;
    font-stretch: var(--stretch-display);
    line-height: 0.9;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .time {
    font-size: var(--size-25);
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .lede {
    max-width: 52ch;
    margin: 16px 0 0;
    color: var(--ink-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 28px;
  }
  .hint {
    margin: 12px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }

  @media (max-width: 599px) {
    .actions .pill {
      flex: 1 1 100%;
    }
  }
</style>
