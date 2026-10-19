<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { SearchSession as Session } from '../search/session';

  // A live room's round: the room page owns the course, the search and the connection, and hears
  // every move. The race runs exactly as a solo one inside it.
  export interface RoomRace {
    from: string;
    to: string;
    // unique per room and round (sessionStorage key for a reload)
    key: string;
    // local time the race begins (the countdown runs to it)
    startAt: number;
    // the time limit in minutes, and the local time it runs out (anyone still racing doesn't finish)
    limit: number;
    endsAt: number;
    // 'time': first to the finish wins, on a real-time clock from the start
    scoring: 'clicks' | 'time';
    // a timed round's first finisher, when it isn't you
    winner: { name: string; timeMs: number } | null;
    // your time on the room's clock, once you've finished
    myTimeMs: number | null;
    session: Session | null;
    onmove(clicks: number, title: string): void;
    onfinish(clicks: number, timeMs: number, route: string[]): void;
    ongiveup(clicks: number): void;
    onleave(): void;
    board: Snippet;
    // the room's table, above the splits in the result
    table: Snippet;
    // other players' routes, drawn on the result's map once the round ends
    others: string[][];
  }
</script>

<script lang="ts">
  // A race: the start card (no par) or a room's countdown, the race itself, then the reveal and the
  // result. The shortest-route search starts before the race and runs unseen, so the reveal is
  // ready when the player arrives. No going back, no Find; a reload resumes the same race.
  import { flushSync, onDestroy, onMount } from 'svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
  import Wordmark from '../components/Wordmark.svelte';
  import ChallengePanel from '../components/ChallengePanel.svelte';
  import FriendsSheet from '../components/FriendsSheet.svelte';
  import Article from '../components/Article.svelte';
  import CourseHero from '../components/CourseHero.svelte';
  import Footer from '../components/Footer.svelte';
  import Pins from '../components/Pins.svelte';
  import Reveal from '../components/Reveal.svelte';
  import RouteLine from '../components/RouteLine.svelte';
  import ShareButton from '../components/ShareButton.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Trail from '../components/Trail.svelte';
  import { dailyNumber } from '../data/daily';
  import { clock, displayTitle, limitWords, plural, resultUrl, shareText, splits } from '../data/share';
  import { recordDaily } from '../data/record';
  import { markFinished, readJson, writeJson } from '../data/storage';
  import { TEXT_SIZES, readTextSize, stepTextSize } from '../data/textSize';
  import { getTheme, setTheme, type Theme } from '../data/theme';
  import { startTier } from '../map/tiers';
  import { loadArticle, type Article as Loaded } from '../race/article';
  import { guardRace, inTextField, type Blocked } from '../race/guards';
  import { Clock, addTime, clicks, current, elapsedMs, giveUp, land, loadRace, move, newRace, sameTitle, saveRace, type RaceState } from '../race/state';
  import { SearchClient, supported } from '../search/client';
  import { SearchSession, running } from '../search/session';
  import { normaliseTitle } from '../search/titles';
  import { WikiError } from '../wiki/api';

  let { room = null }: { room?: RoomRace | null } = $props();
  // the room page remounts this per round, so the round's details are read once
  // svelte-ignore state_referenced_locally
  const inRoom = room;

  const q = new URLSearchParams(location.search);
  const param = (k: string) => (q.get(k)?.trim() ? normaliseTitle(q.get(k)!) : '');
  const from = inRoom ? inRoom.from : param('from');
  const to = inRoom ? inRoom.to : param('to');
  const extra = inRoom ? {} : { ...(q.get('daily') ? { daily: q.get('daily')! } : {}), ...(q.get('ch') ? { ch: q.get('ch')! } : {}) };
  const storeKey = inRoom ? `wikiracer.room.${inRoom.key}` : undefined;
  const timed = inRoom?.scoring === 'time';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  type Phase = 'invalid' | 'same' | 'card' | 'countdown' | 'race' | 'result';
  let phase = $state<Phase>(!from || !to ? 'invalid' : sameTitle(from, to) ? 'same' : inRoom ? 'countdown' : 'card');
  let left = $state(5);
  let friendsOpen = $state(false);
  let leaveOpen = $state(false);
  let race = $state.raw<RaceState>(newRace(from, to, extra));
  let article = $state.raw<Loaded | null>(null);
  let pending = $state('');
  let loading = $state(false);
  let loadError = $state<'missing' | 'failed' | null>(null);
  let elapsed = $state(0);
  let toast = $state('');
  // counts messages, so the same one shown again is announced again
  let toastN = $state(0);
  let announce = $state('');
  let takeover = $state(false);
  let confirmOpen = $state(false);
  let rulesOpen = $state(false);
  let theme = $state<Theme>(getTheme());
  // links pinned from the article on screen (at most MAX_PINS, the oldest dropped)
  let pins = $state<string[]>([]);
  let textScale = $state(readTextSize());
  let session = $state.raw<SearchSession | null>(null);
  // after giving up: the shortest route from the article given up on
  let fromHere = $state<{ title: string; titles: string[] | null; done: boolean } | null>(null);
  // a timed room: someone else won; stopped = went to the results instead of racing on
  let winnerOpen = $state(false);
  let winnerSeen = false;
  let stopped = $state(readFlag('stopped'));
  // a room's time limit ran out before the finish
  let timeUp = $state(readFlag('timeup'));
  // ms left before a room's time limit
  let remaining = $state(Infinity);
  // a timed finish on this device's clock, until the room's own time arrives
  let realMs = $state<number | null>(null);

  let view = $state<HTMLElement>();
  let menu = $state<HTMLElement>();
  const timer = new Clock();
  let client: SearchClient | null = null;
  let stopGuard: (() => void) | null = null;
  let loadAbort: AbortController | null = null;
  let prefetch: { title: string; ctrl: AbortController; promise: Promise<Loaded> } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const n = $derived(clicks(race));
  let daily = $state<number | null>(null);
  if (extra.daily) void dailyNumber(extra.daily).then((d) => (daily = d));
  const seconds = $derived(Math.round((timed ? (room?.myTimeMs ?? realMs ?? elapsedMs(race)) : elapsedMs(race)) / 100) / 10);
  const shared = $derived({ from, to, via: race.route.slice(1, -1), seconds });
  // the shortest route's length, once the search has found it (for the share card)
  let shortest = $state<number | null>(null);
  $effect(() => {
    const s = session;
    if (!s) return;
    const update = () => {
      if (s.status.kind === 'found') shortest = s.status.distance;
    };
    update();
    return s.on(update);
  });
  const card = $derived(shareText(shared, { url: resultUrl(shared, location.origin), shortest, ...(daily ? { daily } : {}) }));
  const deadEnd = $derived(!!article && article.links.size === 0);

  function startSearch() {
    if (inRoom) {
      session = inRoom.session;
      client = inRoom.session?.client ?? null;
      return;
    }
    if (!supported()) return;
    client ??= new SearchClient();
    session = new SearchSession(client, from, to, startTier().drawBudget);
    void session.start();
  }

  function say(message: string) {
    toast = message;
    toastN++;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3500);
  }

  function blocked(why: Blocked) {
    say(why === 'back' ? "You can't go back in a race. To leave, give up from the menu." : 'Find is off during a race. Read and scroll.');
  }

  const save = () => saveRace(race, undefined, storeKey);

  function load(title: string, signal: AbortSignal) {
    return loadArticle(title, { signal, onSlowDown: () => say('Wikipedia asked me to slow down. Retrying…') });
  }

  function fetchArticle(title: string): Promise<Loaded> {
    if (prefetch && sameTitle(prefetch.title, title) && !prefetch.ctrl.signal.aborted) {
      const { promise } = prefetch;
      prefetch = null;
      return promise;
    }
    loadAbort?.abort();
    loadAbort = new AbortController();
    return load(title, loadAbort.signal);
  }

  // The next article starts loading on pointerdown; a press that turns into a scroll drops it
  function press(title: string | null) {
    if (title === null || phase !== 'race') {
      prefetch?.ctrl.abort();
      prefetch = null;
      return;
    }
    if (prefetch && sameTitle(prefetch.title, title)) return;
    prefetch?.ctrl.abort();
    const ctrl = new AbortController();
    const promise = load(title, ctrl.signal);
    promise.catch(() => undefined);
    prefetch = { title, ctrl, promise };
  }

  // Shows the route's current article; the clock resumes once it's on screen
  async function show(title: string) {
    loading = true;
    loadError = null;
    try {
      const a = await fetchArticle(title);
      race = land(race, a.title);
      save();
      if (race.status === 'finished') return finish();
      if (inRoom && n > 0) inRoom.onmove(n, a.title);
      article = a;
      pending = '';
      timer.start();
      announce = n > 0 ? `Now on ${a.display}. ${plural(n, 'click')}.` : `Now on ${a.display}. The race has started.`;
      if (n === 0) pinTip();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      loadError = e instanceof WikiError && e.status === 404 ? 'missing' : 'failed';
    } finally {
      loading = false;
    }
  }

  // The tapped link's text morphs into the next article's title while the old article slides away
  function morph(link: Element, update: () => void): Promise<void> {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { updateCallbackDone: Promise<void> } };
    if (!doc.startViewTransition || reducedMotion) {
      update();
      view?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
      return Promise.resolve();
    }
    const el = link as HTMLElement;
    el.style.viewTransitionName = 'jump';
    return doc
      .startViewTransition(() => {
        el.style.viewTransitionName = '';
        flushSync(update);
      })
      .updateCallbackDone.catch(() => undefined);
  }

  function follow(target: string, link: Element) {
    if (loading || !article || phase !== 'race') return;
    loading = true;
    // pins belong to the article they were pinned from
    pins = [];
    if (!reducedMotion) navigator.vibrate?.(10);
    race = move(addTime(race, timer.stop()), target);
    save();
    if (sameTitle(target, to)) {
      race = land(race, to);
      prefetch?.ctrl.abort();
      return finish();
    }
    void morph(link, () => {
      article = null;
      pending = displayTitle(target);
      scrollTo(0, 0);
    }).then(() => show(target));
  }

  const MAX_PINS = 6;
  function pinLink(target: string) {
    if (phase !== 'race') return;
    if (pins.some((p) => sameTitle(p, target))) {
      announce = `${displayTitle(target)} is already pinned.`;
      return;
    }
    pins = [...pins, target].slice(-MAX_PINS);
    announce = `Pinned ${displayTitle(target)}.`;
    writeJson(PIN_TIP, true);
  }
  const unpin = (target: string) => (pins = pins.filter((p) => p !== target));

  // The first race on this device mentions pinning, once an article is on screen
  const PIN_TIP = 'wikiracer.pinTip';
  const coarse = matchMedia('(pointer: coarse)').matches;
  function pinTip() {
    if (readJson(PIN_TIP, false)) return;
    writeJson(PIN_TIP, true);
    say(coarse ? 'Tip: press and hold a link to pin it, so you can come back to it.' : 'Tip: right-click a link to pin it, so you can come back to it.');
  }

  function begin() {
    race = newRace(from, to, extra);
    phase = 'race';
    pending = displayTitle(from);
    stopGuard = guardRace(blocked);
    void show(from);
  }

  // Leaves race mode: guards off, the guard entry dropped from history
  function end() {
    winnerOpen = false;
    timer.stop();
    stopGuard?.();
    stopGuard = null;
    loadAbort?.abort();
    prefetch?.ctrl.abort();
    prefetch = null;
    if (history.state && typeof history.state === 'object' && 'wikiracerGuard' in history.state) history.back();
    takeover = true;
    phase = 'result';
    scrollTo(0, 0);
  }

  function finish() {
    loading = false;
    if (timed) realMs = Date.now() - inRoom!.startAt;
    race = { ...race, status: 'finished' };
    save();
    markFinished(from, to);
    if (extra.daily) recordDaily(extra.daily, { clicks: n, seconds: Math.round(elapsedMs(race) / 100) / 10 });
    // the room checks the route against the course's own titles, whatever redirects were followed
    inRoom?.onfinish(n, Math.round(elapsedMs(race)), [from, ...race.route.slice(1, -1), to]);
    end();
  }

  function quit() {
    confirmOpen = false;
    race = giveUp(addTime(race, timer.stop()));
    save();
    inRoom?.ongiveup(n);
    end();
    afterGiveUp();
  }

  // A timed room's winner is home: the others choose to race on or to see the results
  $effect(() => {
    if (room?.winner && phase === 'race' && !winnerSeen) {
      winnerSeen = true;
      winnerOpen = true;
    }
  });

  function readFlag(name: 'stopped' | 'timeup'): boolean {
    try {
      return !!storeKey && sessionStorage.getItem(`${storeKey}.${name}`) === '1';
    } catch {
      return false;
    }
  }

  function setFlag(name: 'stopped' | 'timeup') {
    try {
      sessionStorage.setItem(`${storeKey}.${name}`, '1');
    } catch {
      // a reload shows the plain give-up wording, nothing worse
    }
  }

  // Stopping counts as giving up; the result leaves out the map
  function seeResults() {
    winnerOpen = false;
    stopped = true;
    setFlag('stopped');
    race = giveUp(addTime(race, timer.stop()));
    save();
    inRoom?.ongiveup(n);
    end();
    takeover = false;
    afterGiveUp();
  }

  // The room's time limit ran out: the run ends here, and the room marks it unfinished by itself
  function outOfTime() {
    timeUp = true;
    setFlag('timeup');
    race = giveUp(addTime(race, timer.stop()));
    save();
    end();
    say("Time's up.");
    afterGiveUp();
  }

  function leaveRoom() {
    leaveOpen = false;
    stopGuard?.();
    stopGuard = null;
    inRoom?.onleave();
  }

  // The second search, from where the player gave up, once the first has finished with the worker.
  // In a room the worker outlives this page, so the search goes with it (it would stop the next
  // round's search otherwise)
  let fromHereSearch: SearchSession | null = null;
  let destroyed = false;
  function afterGiveUp() {
    const here = current(race);
    if (!client || !here || sameTitle(here, from)) return;
    fromHere = { title: here, titles: null, done: false };
    const go = () => {
      if (destroyed) return;
      const s = new SearchSession(client!, here, to, 1000);
      fromHereSearch = s;
      s.on(() => {
        if (running(s.status)) return;
        fromHere = { title: here, titles: s.status.kind === 'found' ? s.status.titles : null, done: true };
        s.cancel();
      });
      void s.start();
    };
    const main = session;
    if (!main || !running(main.status)) return go();
    const off = main.on(() => {
      if (running(main.status)) return;
      off();
      go();
    });
  }

  function onKey(e: KeyboardEvent) {
    if (phase === 'race' && e.key === '?' && !inTextField(e.target)) {
      e.preventDefault();
      rulesOpen = true;
    }
  }

  function pickTheme(t: Theme) {
    theme = t;
    setTheme(t);
  }

  function openFromMenu(which: 'giveUp' | 'rules' | 'leave') {
    menu?.hidePopover?.();
    if (which === 'giveUp') confirmOpen = true;
    else if (which === 'leave') leaveOpen = true;
    else rulesOpen = true;
  }

  // the clock text, from the saved legs plus the leg on screen; in a room, the countdown too
  const tickTimer = setInterval(() => {
    elapsed = timed && phase === 'race' ? Math.max(0, Date.now() - inRoom!.startAt) : elapsedMs(race) + timer.peek();
    if (inRoom && phase === 'race') {
      const was = remaining;
      remaining = inRoom.endsAt - Date.now();
      if (remaining <= 0) outOfTime();
      else if (remaining <= 60_000 && was > 60_000) announce = 'One minute left.';
    }
    if (phase === 'countdown' && inRoom) {
      const next = Math.max(0, Math.ceil((inRoom.startAt - Date.now()) / 1000));
      if (next !== left && next > 0 && next <= 3) announce = String(next);
      left = next;
    }
  }, 100);
  let countdownTimer: ReturnType<typeof setTimeout> | undefined;

  // Hidden or closed: the time so far is saved; shown again from the back-forward cache: resumed
  function onHide() {
    if (phase === 'race' && timer.running) {
      race = addTime(race, timer.stop());
      save();
    }
  }
  function onShow(e: PageTransitionEvent) {
    if (e.persisted && phase === 'race' && article) timer.start();
  }
  addEventListener('pagehide', onHide);
  addEventListener('pageshow', onShow);

  onMount(() => {
    if (phase !== 'card' && phase !== 'countdown') return;
    startSearch();
    const saved = loadRace(from, to, undefined, storeKey);
    if (saved?.status === 'racing' && saved.route.length) {
      race = saved;
      phase = 'race';
      pending = displayTitle(current(saved));
      stopGuard = guardRace(blocked);
      void show(current(saved));
    } else if (saved && saved.status !== 'racing' && saved.route.length) {
      race = saved;
      phase = 'result';
      if (saved.status === 'gaveUp') afterGiveUp();
    } else if (inRoom) {
      // every device loads the start article during the countdown, so nobody starts behind
      announce = 'Starting in 5';
      prefetchStart();
      countdownTimer = setTimeout(() => {
        announce = 'Go';
        begin();
      }, Math.max(0, inRoom.startAt - Date.now()));
    } else {
      prefetchStart();
    }
  });

  function prefetchStart() {
    const ctrl = new AbortController();
    const promise = load(from, ctrl.signal);
    promise.catch(() => undefined);
    prefetch = { title: from, ctrl, promise };
  }

  onDestroy(() => {
    clearInterval(tickTimer);
    clearTimeout(toastTimer);
    clearTimeout(countdownTimer);
    removeEventListener('pagehide', onHide);
    removeEventListener('pageshow', onShow);
    stopGuard?.();
    prefetch?.ctrl.abort();
    destroyed = true;
    fromHereSearch?.cancel();
    // a room's search and worker belong to the room page
    if (!inRoom) {
      session?.cancel();
      client?.terminate();
    }
  });
</script>

<svelte:window onkeydown={onKey} />

{#snippet rules()}
  <ol class="rules">
    <li>Get from the start article to the finish by tapping links inside the articles.</li>
    <li>Every link to another article works, including the ones in the navigation boxes at the bottom.</li>
    <li>No going back. Once you leave an article, the only way back to it is a link on a later page.</li>
    <li>No Find. Read and scroll.</li>
    <li>{coarse ? 'Press and hold a link' : 'Right-click a link'} to pin it, then tap the pin to take that link later, without scrolling back to it.</li>
    {#if inRoom}
      <li>You have {limitWords(inRoom.limit)} to reach the finish. Anyone still racing then doesn't finish.</li>
    {/if}
    {#if timed}
      <li>The clock runs in real time from the start, loading included.</li>
      <li>First to the finish wins.</li>
    {:else}
      <li>Every click counts, so choose carefully. The clock only runs while an article is on screen; loading time doesn't count.</li>
      <li>Fewest clicks wins. Time only breaks ties.</li>
    {/if}
  </ol>
{/snippet}

{#snippet hudStats()}
  <span class="finish-chip">
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><circle class="core" cx="10" cy="10" r="3.5" /></svg>
    <span class="sr">Finish: </span><span class="chip-title">{displayTitle(to)}</span>
  </span>
  <span class="stat clicks"><span class="num">{n}</span> <span class="unit">{n === 1 ? 'click' : 'clicks'}</span></span>
  {#if remaining <= 60_000}
    <span class="stat time left" role="timer" aria-label="Time left">{clock(Math.ceil(remaining / 1000))} left</span>
  {:else}
    <span class="stat time" role="timer" aria-label="Race clock">{clock(elapsed / 1000)}</span>
  {/if}
{/snippet}

<div class="toast" role="status" data-n={toastN}>{#key toastN}{#if toast}<p>{toast}</p>{/if}{/key}</div>
<p class="sr" aria-live="polite">{announce}</p>

{#if phase === 'invalid' || phase === 'same'}
  <SiteHeader plain />
  <main class="page" id="main">
    <h1 class="missing">{phase === 'same' ? 'Start and finish are the same article.' : 'This race link is incomplete.'}</h1>
    <p class="lede">{phase === 'same' ? 'Pick a different finish to race.' : 'It needs a start and a finish. Ask for the link again, or pick a course yourself.'}</p>
    <a class="pill primary" href="/">Go to the home page</a>
  </main>
  <Footer />
{:else if phase === 'card'}
  <SiteHeader plain />
  <main class="card" id="main">
    <CourseHero {from} {to} />
    <section class="how" aria-labelledby="rules-head">
      <h2 id="rules-head">How to race</h2>
      {@render rules()}
    </section>
    <div class="go">
      <button class="pill primary" type="button" onclick={begin}>Start the race</button>
      {#if !extra.ch}<button class="pill secondary" type="button" onclick={() => (friendsOpen = true)}>Race with friends</button>{/if}
    </div>
  </main>
  <Footer />
  <FriendsSheet bind:open={friendsOpen} {from} {to} />
{:else if phase === 'countdown'}
  <div class="race">
    <div class="strip">{@render inRoom?.board()}</div>
    <main class="countdown" id="main">
      <p class="cd-label">Start</p>
      <h1 class="cd-title">{displayTitle(from)}</h1>
      <p class="cd-to">to {displayTitle(to)}</p>
      <p class="cd-num" aria-hidden="true">{#key left}<span>{left > 0 && left <= 3 ? left : ''}</span>{/key}</p>
      {#if left > 3}<p class="cd-ready">Get ready. You have {limitWords(inRoom!.limit)}.</p>{/if}
    </main>
  </div>
{:else if phase === 'race'}
  <a class="skip" href="#article">Skip to article</a>
  <div class="race" class:pinning={pins.length > 0}>
    <header class="hud">
      <Wordmark />
      {@render hudStats()}
      <button class="menu-btn hover-fill" type="button" popovertarget="race-menu" aria-label="Menu">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
      </button>
    </header>
    <div class="strip"><Trail route={race.route} {to} />{@render inRoom?.board()}</div>
    <div class="layout">
      <main id="article" tabindex="-1" bind:this={view} style:--text-scale={textScale}>
        <Article {article} {pending} onmove={follow} onpress={press} onpin={pinLink} pinned={pins} note={loadError ? errorNote : deadEnd ? deadEndNote : undefined} />
      </main>
      {#if pins.length}<Pins {pins} onfollow={follow} onunpin={unpin} />{:else}<p class="pin-hint">{coarse ? 'Press and hold' : 'Right-click'} a link to pin it here, then take it whenever you like.</p>{/if}
    </div>
  </div>
  <div id="race-menu" class="menu" popover="auto" bind:this={menu}>
    <button class="item" type="button" onclick={() => openFromMenu('giveUp')}>Give up</button>
    <button class="item" type="button" onclick={() => openFromMenu('rules')}>Rules</button>
    {#if inRoom}<button class="item" type="button" onclick={() => openFromMenu('leave')}>Leave room</button>{/if}
    <div class="text-size" role="group" aria-labelledby="text-size-head">
      <span id="text-size-head">Text size</span>
      <button class="size-btn hover-fill" type="button" aria-label="Smaller text" disabled={textScale === TEXT_SIZES[0]} onclick={() => (textScale = stepTextSize(textScale, -1))}>
        <span class="a small" aria-hidden="true">A</span>
      </button>
      <span class="pct" aria-live="polite">{Math.round(textScale * 100)}%</span>
      <button class="size-btn hover-fill" type="button" aria-label="Larger text" disabled={textScale === TEXT_SIZES.at(-1)} onclick={() => (textScale = stepTextSize(textScale, 1))}>
        <span class="a" aria-hidden="true">A</span>
      </button>
    </div>
    <fieldset class="themes">
      <legend>Theme</legend>
      {#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const as [value, name] (value)}
        <label><input type="radio" name="theme" {value} checked={theme === value} onchange={() => pickTheme(value)} />{name}</label>
      {/each}
    </fieldset>
  </div>
{:else}
  <SiteHeader plain />
  <main class="result" id="main">
    <h1 class="course-line">{displayTitle(from)} <span>to</span> {displayTitle(to)}</h1>
    <Reveal
      {session}
      {from}
      {to}
      route={race.route}
      clicks={n}
      {seconds}
      voice="race"
      finished={race.status === 'finished'}
      {stopped}
      {timeUp}
      bind:takeover
      extra={resultExtra}
      others={room?.others ?? []}
    />
    {#if !inRoom}
      <div class="after">
        <a class="pill secondary" href="/">Pick another course</a>
      </div>
    {/if}
  </main>
  <Footer />
{/if}

{#snippet errorNote()}
  <div class="note">
    {#if loadError === 'missing'}
      <p>This article isn't on Wikipedia any more, so the race can't go on from here.</p>
      <button class="pill primary" type="button" onclick={() => (confirmOpen = true)}>Give up</button>
    {:else}
      <p>Couldn't load {pending || 'this article'} from Wikipedia. The clock is paused.</p>
      <div class="note-actions">
        <button class="pill primary" type="button" onclick={() => show(current(race))}>Try again</button>
        <button class="pill secondary" type="button" onclick={() => (confirmOpen = true)}>Give up</button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet deadEndNote()}
  <div class="note">
    <p>Nothing on this page links to another article. Give up to see the shortest route.</p>
    <button class="pill primary" type="button" onclick={() => (confirmOpen = true)}>Give up</button>
  </div>
{/snippet}

{#snippet resultExtra()}
  {@render inRoom?.table()}
  {#if extra.ch}
    <ChallengePanel code={extra.ch} {from} {to} checkRoutes={session ? (r) => session!.client.check(r) : null} result={{ status: race.status === 'finished' ? 'finished' : 'gaveup', clicks: n, timeMs: Math.round(elapsedMs(race)), route: [from, ...race.route.slice(1, race.status === 'finished' ? -1 : undefined), ...(race.status === 'finished' ? [to] : [])] }} />
  {/if}
  {@render fromHereNote()}
  {#if race.route.length > 1}
    <table class="splits">
      <caption>Splits</caption>
      <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col" class="t">Time</th></tr></thead>
      <tbody>
        {#each splits(race.route, race.legs) as leg, i (i)}
          <tr><td>{displayTitle(leg.from)}</td><td>{displayTitle(leg.to)}</td><td class="t">{clock(leg.ms / 1000)}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if race.status === 'finished'}
    <div class="share-row"><ShareButton text={card} /></div>
  {/if}
{/snippet}

{#snippet fromHereNote()}
  {#if fromHere}
    <section class="from-here">
      {#if !fromHere.done}
        <p class="sub">Working out the shortest route from {displayTitle(fromHere.title)}…</p>
      {:else if fromHere.titles}
        <h3>From {displayTitle(fromHere.title)}, the finish was {plural(fromHere.titles.length - 1, 'click')} away</h3>
        <RouteLine titles={fromHere.titles} />
      {:else}
        <p class="sub">My map has no route from {displayTitle(fromHere.title)} to {displayTitle(to)}.</p>
      {/if}
    </section>
  {/if}
{/snippet}

<Sheet bind:open={confirmOpen} title="Give up?">
  <p class="sheet-text">You'll see the shortest route from {displayTitle(from)}, and from {displayTitle(current(race) || from)}. The race counts as unfinished.</p>
  <div class="sheet-actions">
    <button class="pill primary" type="button" onclick={quit}>Give up</button>
    <button class="pill secondary" type="button" onclick={() => (confirmOpen = false)}>Keep racing</button>
  </div>
</Sheet>

<Sheet bind:open={leaveOpen} title="Leave the room?">
  <p class="sheet-text">Leaving during a race counts as giving up. Your seat stays yours if you come back with this browser.</p>
  <div class="sheet-actions">
    <button class="pill primary" type="button" onclick={leaveRoom}>Leave room</button>
    <button class="pill secondary" type="button" onclick={() => (leaveOpen = false)}>Keep racing</button>
  </div>
</Sheet>

<Sheet bind:open={winnerOpen} title="{room?.winner?.name ?? 'Someone'} won">
  {#if room?.winner}
    <p class="sheet-text">{room.winner.name} reached {displayTitle(to)} first, in {clock(room.winner.timeMs / 1000)}. Keep racing for a place, or stop and see the results.</p>
  {/if}
  <div class="sheet-actions">
    <button class="pill primary" type="button" onclick={() => (winnerOpen = false)}>Keep racing</button>
    <button class="pill secondary" type="button" onclick={seeResults}>See the results</button>
  </div>
</Sheet>

<Sheet bind:open={rulesOpen} title="How to race">
  {@render rules()}
</Sheet>

<style>
  .missing {
    margin: 0 0 16px;
    font: 760 var(--size-39) / 1 var(--font);
    font-stretch: var(--stretch-heading);
  }
  .lede {
    margin: 0 0 28px;
    color: var(--ink-2);
  }

  /* Start card */
  .card {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px var(--gutter) 0;
  }
  .how {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  .how h2 {
    margin: 0 0 12px;
    font-size: var(--size-20);
    font-weight: 680;
    font-stretch: var(--stretch-heading);
  }
  .rules {
    margin: 0;
    padding-left: 1.4em;
    max-width: 60ch;
  }
  .rules li {
    margin-bottom: 8px;
    padding-left: 4px;
  }
  .rules li::marker {
    color: var(--ink-2);
    font-weight: 600;
  }
  /* the primary action sits in the thumb zone on phones */
  .go {
    position: sticky;
    bottom: 0;
    margin-top: 24px;
    padding: 16px 0 calc(16px + env(safe-area-inset-bottom));
    background: linear-gradient(to bottom, transparent, var(--bg) 24px);
  }
  @media (max-width: 599px) {
    .go .pill {
      width: 100%;
    }
  }

  /* A room's countdown: the start article's title, then 3, 2, 1 over it */
  .countdown {
    position: relative;
    display: grid;
    align-content: center;
    min-height: calc(100dvh - 120px);
    max-width: var(--measure);
    margin: 0 auto;
    padding: 24px var(--gutter);
  }
  .cd-label,
  .cd-to,
  .cd-ready {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-20);
  }
  .cd-title {
    margin: 4px 0 8px;
    font-size: var(--size-display);
    font-weight: 780;
    font-stretch: var(--stretch-display);
    line-height: 0.95;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .cd-num {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    pointer-events: none;
  }
  .cd-num span {
    color: var(--signal);
    font-size: clamp(8rem, 40vw, 16rem);
    font-weight: 800;
    font-stretch: 125%;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 24px var(--bg);
    animation: cd-in 900ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
  }
  @keyframes cd-in {
    from {
      transform: scale(1.4);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cd-num span {
      animation: none;
    }
  }
  .go {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  /* Race */
  .skip {
    position: absolute;
    left: 8px;
    top: -60px;
    z-index: 40;
    padding: 10px 14px;
    border-radius: 6px;
    background: var(--bg);
  }
  .skip:focus {
    top: 8px;
  }
  .race {
    padding-bottom: calc(72px + env(safe-area-inset-bottom));
  }
  /* room for the row of pins over the race bar */
  .race.pinning {
    padding-bottom: calc(130px + env(safe-area-inset-bottom));
  }
  .strip {
    position: sticky;
    top: 0;
    z-index: 15;
    view-transition-name: trail;
  }
  .hud {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: calc(64px + env(safe-area-inset-bottom));
    padding: 0 8px env(safe-area-inset-bottom) var(--gutter);
    border-top: 1px solid var(--line);
    background: var(--bg);
    view-transition-name: hud;
  }
  .hud :global(.wordmark) {
    display: none;
  }
  .finish-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
    font-weight: 650;
    font-stretch: var(--stretch-data);
  }
  .finish-chip svg {
    flex: none;
    width: 18px;
    height: 18px;
  }
  .finish-chip circle {
    fill: var(--bg);
    stroke: var(--flare);
    stroke-width: 2.5px;
  }
  .finish-chip .core {
    fill: var(--flare);
    stroke: none;
  }
  .chip-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .clicks .num {
    font-size: var(--size-25);
    font-weight: 800;
    font-stretch: var(--stretch-display);
    line-height: 1;
  }
  .clicks .unit {
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .time {
    min-width: 3.2em;
    color: var(--ink-2);
    font-weight: 600;
    text-align: right;
  }
  /* the last minute of a room's time limit */
  .time.left {
    color: var(--ink);
    font-weight: 750;
  }
  .menu-btn {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .menu-btn svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }
  .menu {
    position: fixed;
    inset: auto 8px calc(72px + env(safe-area-inset-bottom)) auto;
    min-width: 220px;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    box-shadow: var(--shadow-sheet);
  }
  .item {
    display: block;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--ink);
    font: 600 var(--size-16) / 1 var(--font);
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--bg-sunk);
  }
  /* smaller and larger text, the page staying under the open menu so the change shows */
  .text-size {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    padding: 6px 4px 0 12px;
    border-top: 1px solid var(--line);
    font-family: var(--font);
  }
  .text-size > span:first-child {
    flex: 1 1 auto;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .size-btn {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink);
    cursor: pointer;
  }
  .size-btn:disabled {
    color: var(--ink-2);
    opacity: 0.45;
    cursor: default;
  }
  .a {
    font: 700 1.25rem / 1 var(--font);
  }
  .a.small {
    font-size: 0.875rem;
  }
  .pct {
    min-width: 3.2em;
    font-size: var(--size-13);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .themes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 8px 0 0;
    padding: 10px 12px 4px;
    border: 0;
    border-top: 1px solid var(--line);
  }
  .themes legend {
    float: left;
    width: 100%;
    margin-bottom: 4px;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .themes label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
  }
  .note {
    margin: 0 0 28px;
    padding: 16px;
    border-radius: 12px;
    background: var(--bg-sunk);
  }
  .note p {
    margin: 0 0 14px;
  }
  .note-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .toast {
    position: fixed;
    left: 50%;
    top: calc(56px + env(safe-area-inset-top));
    z-index: 25;
    width: min(440px, calc(100vw - 32px));
    transform: translateX(-50%);
    pointer-events: none;
  }
  .toast p {
    margin: 0;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--ink);
    color: var(--bg);
    font-weight: 550;
    box-shadow: var(--shadow-sheet);
  }

  /* the pins' column is only there on wide screens */
  .pin-hint {
    display: none;
  }
  @media (min-width: 900px) {
    .race {
      padding-bottom: 0;
    }
    /* room for the row of pins at the foot of the window */
    .race.pinning {
      padding-bottom: 60px;
    }
    .hud {
      position: sticky;
      top: 0;
      bottom: auto;
      /* the site header's height and edges, so the wordmark and the menu sit where they do on
         every other page */
      min-height: 65px; /* 64 px and the 1 px rule under it */
      padding: 0 var(--edge);
      border-top: 0;
      border-bottom: 1px solid var(--line);
    }
    .hud :global(.wordmark) {
      display: inline-flex;
      margin-right: 12px;
    }
    .finish-chip {
      flex: 0 1 auto;
      margin-left: auto;
    }
    .strip {
      top: 65px;
    }
    .menu {
      inset: 68px var(--edge) auto auto;
    }
    .toast {
      top: 120px;
    }
  }
  /* desktop: the stats stay in the header and the trail and the board in the strip under it, so
     the article runs the page's full width, centred */
  @media (min-width: 1100px) {
    /* one bar: the trail, then a room's board at the right */
    .strip {
      display: flex;
      background: var(--bg-sunk);
    }
    .strip :global(.trail) {
      flex: 1 1 auto;
    }
    /* the pins' column is kept from the start, so pinning never narrows the text */
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 15rem;
      gap: 8px;
      max-width: 1240px;
      margin: 0 auto;
      padding-right: var(--gutter);
    }
    .race.pinning {
      padding-bottom: 0;
    }
    .layout :global(.view) {
      max-width: none;
    }
    .pin-hint {
      position: sticky;
      top: 140px;
      align-self: start;
      display: block;
      margin: 24px 0 0;
      padding: 12px 14px;
      border: 1px dashed var(--line);
      border-radius: 12px;
      color: var(--ink-2);
      font-size: var(--size-13);
      line-height: 1.45;
    }
  }

  /* Result */
  .result {
    max-width: 1240px;
    margin: 0 auto;
    padding: 32px var(--gutter) 56px;
  }
  .course-line {
    margin: 0;
    font-size: var(--size-20);
    font-weight: 650;
    font-stretch: var(--stretch-heading);
  }
  .course-line span {
    color: var(--ink-2);
    font-weight: 450;
  }
  .from-here {
    margin-top: 28px;
  }
  .from-here h3 {
    margin: 0 0 14px;
    font-size: var(--size-16);
    font-weight: 600;
  }
  .sub {
    margin: 6px 0 0;
    color: var(--ink-2);
  }
  .after {
    margin-top: 32px;
  }
  .splits {
    width: 100%;
    margin-top: 28px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .splits caption {
    margin-bottom: 8px;
    font-weight: 600;
    text-align: left;
  }
  .splits th {
    padding: 0 8px 6px 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 550;
    text-align: left;
  }
  .splits td {
    padding: 8px 8px 8px 0;
    border-top: 1px solid var(--line);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .splits .t {
    width: 4.5em;
    padding-right: 0;
    text-align: right;
  }
  .share-row {
    margin-top: 24px;
  }
  .sheet-text {
    margin: 0 0 20px;
  }
  .sheet-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  /* The jump: the old article slides out left, the new title arrives from the link */
  :global(html.racing::view-transition-old(root)) {
    animation: 220ms cubic-bezier(0.4, 0, 1, 1) both race-out;
  }
  :global(html.racing::view-transition-new(root)) {
    animation: 220ms cubic-bezier(0, 0, 0.2, 1) 60ms both race-in;
  }
  :global(html.racing::view-transition-group(jump)) {
    animation-duration: 320ms;
    animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes -global-race-out {
    to {
      transform: translateX(-24%);
      opacity: 0;
    }
  }
  @keyframes -global-race-in {
    from {
      opacity: 0;
    }
  }
</style>
