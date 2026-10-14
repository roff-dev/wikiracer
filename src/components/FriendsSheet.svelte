<script lang="ts">
  // Race with friends: a live room or a challenge link on this course. A nickname, an invisible
  // Turnstile check, then the code (large, 3 + 3), its link, and Share or Copy.
  import Sheet from './Sheet.svelte';
  import ShareButton from './ShareButton.svelte';
  import { checkName, showCode } from '../../worker/names';
  import type { Mode } from '../../worker/protocol';
  import { displayTitle } from '../data/share';
  import { RoomApiError, createCourse, restingText, saveName, savedName } from '../room/api';
  import { turnstileToken } from '../room/turnstile';

  let { open = $bindable(false), from, to }: { open?: boolean; from: string; to: string } = $props();

  let mode = $state<Mode>('live');
  let name = $state(savedName());
  let busy = $state(false);
  let problem = $state('');
  let code = $state<string | null>(null);
  let copied = $state(false);
  let widget = $state<HTMLElement>();

  const link = $derived(code ? `${location.origin}/${mode === 'live' ? 'room' : 'challenge'}/?c=${code}` : '');
  const go = $derived(code ? (mode === 'live' ? `/room/?c=${code}` : `/race/?${new URLSearchParams({ from, to, ch: code })}`) : '');
  const invite = $derived(
    mode === 'live'
      ? `Race me on Wikiracer: ${displayTitle(from)} to ${displayTitle(to)}. Room ${code ? showCode(code) : ''}\n${link}`
      : `Beat my route on Wikiracer: ${displayTitle(from)} to ${displayTitle(to)}\n${link}`,
  );

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const n = checkName(name);
    if (!n.ok) {
      problem = n.reason === 'blocked' ? 'Pick another name.' : n.reason === 'length' ? 'Your nickname needs 1 to 16 characters.' : 'Use letters, digits, spaces and - _ . \' only.';
      return;
    }
    busy = true;
    problem = '';
    try {
      const token = await turnstileToken(widget!).catch(() => {
        throw new RoomApiError('turnstile');
      });
      code = await createCourse({ mode, from, to, name: n.name, turnstile: token });
      saveName(n.name);
    } catch (err) {
      const c = err instanceof RoomApiError ? err.code : 'server';
      problem =
        c === 'turnstile'
          ? "Couldn't confirm you're a person. Try again."
          : c === 'resting'
            ? restingText()
            : c === 'name'
              ? 'Pick another name.'
              : c === 'network'
                ? "Couldn't reach Wikiracer. Check your connection and try again."
                : 'Something went wrong on my side. Try again.';
    } finally {
      busy = false;
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // the code is on screen to type
    }
  }

  // closing the sheet starts it over next time
  $effect(() => {
    if (!open && code) {
      code = null;
      problem = '';
    }
  });
</script>

<Sheet bind:open title="Race with friends">
  {#if !code}
    <form class="friends" onsubmit={create}>
      <fieldset class="modes">
        <legend class="sr">How to play</legend>
        <label class="mode" class:on={mode === 'live'}>
          <input type="radio" name="mode" value="live" bind:group={mode} />
          <span class="mode-name">Live room</span>
          <span class="mode-desc">Race now, together. Up to 4 players, each on their own device.</span>
        </label>
        <label class="mode" class:on={mode === 'challenge'}>
          <input type="radio" name="mode" value="challenge" bind:group={mode} />
          <span class="mode-name">Challenge link</span>
          <span class="mode-desc">Play any time. Up to 4 results on one table.</span>
        </label>
      </fieldset>
      <label class="name">
        <span>Your nickname</span>
        <input type="text" bind:value={name} maxlength="32" autocomplete="nickname" required />
      </label>
      <div class="widget" bind:this={widget}></div>
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
      <button class="pill primary" type="submit" disabled={busy}>{busy ? 'Creating…' : mode === 'live' ? 'Create the room' : 'Create the challenge'}</button>
    </form>
  {:else}
    <div class="made">
      <p class="label">{mode === 'live' ? 'Room code' : 'Challenge code'}</p>
      <button class="code" type="button" onclick={copyCode} aria-label="Code {code.split('').join(' ')}, tap to copy">{showCode(code)}</button>
      <p class="hint" aria-live="polite">{copied ? 'Code copied.' : 'Tap the code to copy it.'}</p>
      <p class="link">{link}</p>
      <ShareButton text={invite} />
      <a class="pill secondary" href={go}>{mode === 'live' ? 'Go to the room' : 'Race it'}</a>
    </div>
  {/if}
</Sheet>

<style>
  .friends,
  .made {
    display: grid;
    gap: 16px;
  }
  .modes {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .mode {
    position: relative;
    display: grid;
    gap: 2px;
    padding: 12px 14px 12px 44px;
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
  }
  .mode.on {
    border-color: var(--signal);
    box-shadow: inset 0 0 0 1px var(--signal);
  }
  .mode input {
    position: absolute;
    left: 14px;
    top: 15px;
    margin: 0;
    accent-color: var(--signal);
  }
  .mode-name {
    font-weight: 650;
  }
  .mode-desc {
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .name {
    display: grid;
    gap: 6px;
    font-weight: 600;
  }
  .name input {
    min-height: 48px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: var(--ink);
    font: 500 var(--size-16) / 1.2 var(--font);
  }
  .widget:empty {
    display: none;
  }
  .problem {
    margin: 0;
    color: var(--ink);
  }
  .label {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  /* the code: Mona Sans width 125, weight 800, grouped 3 + 3 */
  .code {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    font: 800 clamp(2.6rem, 14vw, 4rem) / 1 var(--font);
    font-stretch: 125%;
    letter-spacing: 0.04em;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .hint,
  .link {
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    overflow-wrap: anywhere;
  }
</style>
