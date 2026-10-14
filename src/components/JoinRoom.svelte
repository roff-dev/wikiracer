<script lang="ts">
  // Join a room by its code: typed or pasted in any case, with or without spaces. The room page
  // sends a challenge code on to the challenge page.
  import { normaliseCode } from '../../worker/names';

  let value = $state('');
  let problem = $state('');

  function join(e: SubmitEvent) {
    e.preventDefault();
    const code = normaliseCode(value);
    if (!code) {
      problem = 'A room code has 6 letters and digits, like K7M 2QX.';
      return;
    }
    location.assign(`/room/?c=${code}`);
  }
</script>

<form class="join" onsubmit={join} novalidate>
  <label for="room-code" class="sr">Room code</label>
  <input
    id="room-code"
    bind:value
    oninput={() => (problem = '')}
    placeholder="K7M 2QX"
    autocomplete="off"
    autocapitalize="characters"
    spellcheck="false"
    maxlength="12"
    aria-invalid={problem ? 'true' : undefined}
    aria-describedby={problem ? 'room-code-msg' : undefined}
  />
  <button class="pill secondary" type="submit">Join</button>
  {#if problem}<p id="room-code-msg" class="msg" role="alert">{problem}</p>{/if}
</form>

<style>
  .join {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  input {
    flex: 0 1 11ch;
    min-width: 0;
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunk);
    color: var(--ink);
    font: 800 var(--size-20) / 1 var(--font);
    font-stretch: var(--stretch-display);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  input::placeholder {
    color: var(--ink-2);
  }
  input[aria-invalid='true'] {
    border-color: var(--flare);
  }
  .msg {
    flex-basis: 100%;
    margin: 0;
  }
</style>
