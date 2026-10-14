<script lang="ts">
  // Home: today's course is the headline and racing it the one primary action. Under it, the
  // other ways in (Surprise me, Set a course, Join a room, the classic courses), and the reveal
  // on loop as a picture of what waits at the finish. Nothing here touches my map: the setter
  // only starts its worker once an article is picked.
  import DailyCard from '../components/DailyCard.svelte';
  import DemoLoop from '../components/DemoLoop.svelte';
  import Footer from '../components/Footer.svelte';
  import GooeyLevels from '../components/GooeyLevels.svelte';
  import FriendsSheet from '../components/FriendsSheet.svelte';
  import JoinRoom from '../components/JoinRoom.svelte';
  import Setter from '../components/Setter.svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
  import { displayTitle } from '../data/share';
  import { hasFinished } from '../data/storage';
  import { surprise, type Difficulty } from '../data/pools';

  let friends = $state<{ from: string; to: string } | null>(null);
  let friendsOpen = $state(false);
  let setter = $state<Setter>();
  let setSection = $state<HTMLElement>();
  let surpriseProblem = $state('');

  const levels: [Difficulty, string][] = [
    ['easy', 'Easy'],
    ['medium', 'Medium'],
    ['hard', 'Hard'],
  ];

  async function surpriseMe(level: Difficulty) {
    surpriseProblem = '';
    try {
      const c = await surprise(level);
      setter?.fill(c.from, c.to);
      setSection?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } catch {
      surpriseProblem = "Couldn't load the courses. Check your connection and try again.";
    }
  }

  const classics = fetch('/classics.json')
    .then((r) => r.json() as Promise<{ courses: { start: string; finish: string }[] }>)
    .then((j) => j.courses)
    .catch(() => []);
  const raceHref = (from: string, to: string) => `/race/?${new URLSearchParams({ from, to })}`;
</script>

<SiteHeader />
<main class="home">
  <section class="today" aria-label="Today's course">
    <DailyCard>
      {#snippet actions({ day, href })}
        <div class="go">
          <a class="pill primary main" {href}>Race today's course</a>
          <button class="pill secondary" type="button" onclick={() => ((friends = { from: day.start, to: day.finish }), (friendsOpen = true))}>Play with friends</button>
        </div>
      {/snippet}
    </DailyCard>
  </section>

  <section class="way surprise" aria-labelledby="surprise-head">
    <h2 id="surprise-head">Surprise me</h2>
    <div class="body">
      <p class="hint">A random course. You only know how hard it is.</p>
      <GooeyLevels options={levels} labelledby="surprise-head" onpick={surpriseMe} />
      {#if surpriseProblem}<p class="msg" role="alert">{surpriseProblem}</p>{/if}
    </div>
  </section>

  <section class="way set" aria-labelledby="set-head" bind:this={setSection}>
    <h2 id="set-head">Set a course</h2>
    <div class="body">
      <Setter bind:this={setter} />
    </div>
  </section>

  <section class="way join" aria-labelledby="join-head">
    <h2 id="join-head">Join a room</h2>
    <div class="body">
      <p class="hint">Type the code a friend sent you.</p>
      <JoinRoom />
    </div>
  </section>

  <section class="show" aria-labelledby="show-head">
    <h2 id="show-head">What you see at the finish</h2>
    <DemoLoop />
  </section>

  <section class="way classic" aria-labelledby="classic-head">
    <h2 id="classic-head">Classic courses</h2>
    <div class="body">
      {#await classics then list}
        <ul class="classics">
          {#each list as c (c.start + c.finish)}
            <li>
              <a href={raceHref(c.start, c.finish)}>
                <svg viewBox="0 0 12 40" aria-hidden="true"><path d="M6 6v28" /><circle class="s" cx="6" cy="6" r="4" /><circle class="f" cx="6" cy="34" r="4" /><circle class="fc" cx="6" cy="34" r="1.6" /></svg>
                <span class="ends"><span>{displayTitle(c.start)}</span><span>{displayTitle(c.finish)}</span></span>
                {#if hasFinished(c.start, c.finish)}<span class="done">Finished</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      {/await}
    </div>
  </section>
</main>
<Footer />
{#if friends}<FriendsSheet bind:open={friendsOpen} from={friends.from} to={friends.to} />{/if}

<style>
  .home {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px var(--gutter) 56px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .today {
    margin-bottom: 40px;
  }
  .go {
    display: grid;
    gap: 12px;
    margin-top: 32px;
  }
  .go .primary {
    font-size: var(--size-20);
  }
  /* the page's one main action stays green; green is also the hover, so it has no hover fill */
  .go .main {
    border: 0;
    background: var(--signal);
    color: var(--on-signal);
  }
  .go .main::before {
    content: none;
  }
  h2 {
    margin: 0;
    font-size: var(--size-20);
    font-weight: 700;
    font-stretch: var(--stretch-heading);
    line-height: 1.2;
  }
  .today + .way {
    border-top: 1px solid var(--line);
  }
  .way,
  .show {
    display: grid;
    gap: 14px;
    padding: 28px 0;
    border-bottom: 1px solid var(--line);
  }
  .body {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .hint,
  .msg {
    margin: 0;
    color: var(--ink-2);
  }
  .msg {
    color: var(--ink);
  }
  .classics {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .classics li + li {
    border-top: 1px solid var(--line);
  }
  .classics a {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 64px;
    padding: 10px 0;
    text-decoration: none;
  }
  .classics svg {
    flex: none;
    width: 12px;
    height: 40px;
  }
  .classics path {
    stroke: var(--line);
    stroke-width: 2;
  }
  .classics .s {
    fill: var(--signal);
  }
  .classics .f {
    fill: var(--bg);
    stroke: var(--flare);
    stroke-width: 1.6;
  }
  .classics .fc {
    fill: var(--flare);
  }
  .ends {
    display: grid;
    flex: 1;
    min-width: 0;
    font-weight: 650;
    font-stretch: var(--stretch-heading);
    line-height: 1.3;
  }
  .classics a:hover .ends {
    text-decoration: underline;
    text-decoration-thickness: 1.5px;
  }
  .done {
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
  }

  /* two columns: today's course left, the reveal right; the ways in below become a ledger with
     their names in the left margin */
  @media (min-width: 900px) {
    .home {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      grid-template-areas: 'today show' 'cta cta' 'surprise surprise' 'set set' 'join join' 'classic classic';
      column-gap: 48px;
      padding-top: 32px;
    }
    /* the card's two groups become grid items: the headline beside the demo, and the rules with
       both actions in one row under them */
    .today {
      display: contents;
    }
    .today :global(.head) {
      grid-area: today;
    }
    .today :global(.cta) {
      grid-area: cta;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px 32px;
      margin: 40px 0 56px;
      padding-left: 34px;
    }
    .today :global(.cta .rules) {
      max-width: none;
      margin: 0;
      padding-left: 0;
    }
    .today :global(.cta .record) {
      flex-basis: 100%;
      margin: 0;
      padding-left: 0;
    }
    .show {
      grid-area: show;
      align-self: start;
      padding: 44px 0 0;
      border: 0;
    }
    .surprise {
      grid-area: surprise;
    }
    .set {
      grid-area: set;
    }
    .join {
      grid-area: join;
    }
    .classic {
      grid-area: classic;
    }
    .go {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 0;
    }
    .way {
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 24px;
    }
    .way h2 {
      padding-top: 10px;
    }
    .set .body {
      max-width: 680px;
    }
    .classics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 32px;
    }
    .classics li:nth-child(2) {
      border-top: 0;
    }
  }

  /* wide screens: the ways in follow the hero's two columns. Set a course sits under the titles,
     the one-tap ways (Surprise me, Join a room) stack under the demo, and the classic courses
     run as one row of four, each drawn like the hero's course */
  @media (min-width: 1100px) {
    .home {
      grid-template-areas: 'today show' 'cta cta' 'set surprise' 'set join' 'classic classic';
      grid-template-rows: auto auto auto 1fr auto;
    }
    .way {
      grid-template-columns: minmax(0, 1fr);
      align-content: start;
      gap: 14px;
      padding: 32px 0;
    }
    .way h2 {
      padding-top: 0;
    }
    .set {
      border-top: 1px solid var(--line);
    }
    .join {
      border-bottom: 1px solid var(--line);
    }
    .set .body {
      max-width: none;
    }
    .classics {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      column-gap: 32px;
    }
    .classics li + li {
      border-top: 0;
    }
  }
</style>
