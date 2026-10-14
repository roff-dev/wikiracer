<script lang="ts">
  // Today's course, typeset as the page's headline: its number and difficulty, the two titles,
  // the one-line rules, the caller's actions, then this browser's record (today's finish, the
  // streak and the best daily). No par: the label is all that's known before the race.
  import type { Snippet } from 'svelte';
  import CourseHero from './CourseHero.svelte';
  import { courseFor, loadSchedule, localDateKey, type DailyDay } from '../data/daily';
  import { best, readRecord, streak } from '../data/record';
  import { clock, plural, scoreWords } from '../data/share';

  let { actions }: { actions: Snippet<[{ day: DailyDay; href: string }]> } = $props();

  const today = localDateKey(new Date());
  const label = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;

  const load = loadSchedule().then((s) => {
    const c = s && courseFor(s, today);
    if (!s || !c) return null;
    const record = readRecord();
    const pars = new Map(s.days.filter((d) => d.date <= today).map((d) => [d.date, d.d]));
    return { ...c, run: record[today] ?? null, streak: streak(record, today), best: best(record, pars) };
  });

  const href = (day: DailyDay) => `/race/?${new URLSearchParams({ from: day.start, to: day.finish, daily: day.date })}`;
</script>

{#await load}
  <div class="loading" aria-hidden="true"></div>
{:then c}
  {#if c}
    <p class="meta">Today, #{c.number}, {label[c.day.label]}</p>
    <CourseHero from={c.day.start} to={c.day.finish} />
    <p class="rules">Get from one to the other by tapping links. Fewest clicks wins.</p>
    {@render actions({ day: c.day, href: href(c.day) })}
    {#if c.run || c.streak > 1 || c.best}
      <dl class="record">
        {#if c.run}<div><dt>Today</dt><dd>{plural(c.run.clicks, 'click')} in {clock(c.run.seconds)}</dd></div>{/if}
        {#if c.streak > 1}<div><dt>Streak</dt><dd>{plural(c.streak, 'day')}</dd></div>{/if}
        {#if c.best}<div><dt>Best</dt><dd>{scoreWords(c.best.clicks, c.best.clicks - c.best.over)}</dd></div>{/if}
      </dl>
    {/if}
  {:else}
    <h1 class="missing">Today's course isn't ready yet.</h1>
    <p class="rules">Pick a difficulty under Surprise me, or one of the classic courses, and race that instead.</p>
  {/if}
{/await}

<style>
  /* about the card's height with one-line titles, so the sections under it don't jump */
  .loading {
    min-height: calc(2 * 0.95 * var(--size-display) + 300px);
  }
  .meta {
    margin: 0 0 20px;
    color: var(--ink-2);
    font-weight: 600;
    font-stretch: var(--stretch-data);
    font-variant-numeric: tabular-nums;
  }
  .rules {
    max-width: 30ch;
    margin: 28px 0 0;
    padding-left: 34px;
    font-size: var(--size-20);
    line-height: 1.35;
    text-wrap: pretty;
  }
  .missing {
    margin: 0;
    font: 780 var(--size-39) / 1 var(--font);
    font-stretch: var(--stretch-display);
    letter-spacing: -0.02em;
  }
  .record {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    margin: 24px 0 0;
    padding-left: 34px;
    font-stretch: var(--stretch-data);
    font-variant-numeric: tabular-nums;
  }
  .record div {
    display: grid;
  }
  dt {
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  dd {
    margin: 0;
    font-weight: 600;
  }
</style>
