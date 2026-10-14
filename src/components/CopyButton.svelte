<script lang="ts">
  // A copy button: the two overlapping squares, which turn into a tick for a moment once the text
  // is on the clipboard. `label` names what it copies ("Copy the code"). In a 44 px circle, or
  // `bare`: the icon alone at the size of the text around it (beside the big room code).
  let { text, label, bare = false }: { text: string; label: string; bare?: boolean } = $props();

  let done = $state(false);
  let failed = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      done = true;
      failed = false;
    } catch {
      // clipboard blocked: the text is on screen to select or type
      failed = true;
    }
    clearTimeout(timer);
    timer = setTimeout(() => ((done = false), (failed = false)), 2000);
  }
</script>

<button class="copy" class:done class:bare class:hover-fill={!bare} type="button" onclick={copy} aria-label={label} title={label}>
  <svg viewBox="0 0 20 20" aria-hidden="true">
    {#if done}<path d="M4.5 10.5l3.5 3.5 7.5-8" />{:else}<rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" />{/if}
  </svg>
</button>
<span class="sr" aria-live="polite">{done ? 'Copied.' : failed ? "Couldn't copy. Select the text instead." : ''}</span>

<style>
  .copy {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink);
    cursor: pointer;
  }
  .copy:active {
    transform: translateY(1px);
  }
  .copy.done {
    border-color: var(--signal);
    color: var(--signal);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  /* bare: no circle; the icon as tall as the code's capitals, the tap area never under 44 px */
  .copy.bare {
    width: auto;
    height: auto;
    min-width: 44px;
    min-height: 44px;
    border: 0;
    border-radius: 8px;
    background: none;
    color: var(--ink-2);
    /* buttons don't inherit the font size on their own */
    font-size: inherit;
  }
  .copy.bare:hover {
    background: none;
    color: var(--ink);
  }
  .copy.bare.done {
    color: var(--signal);
  }
  .copy.bare svg {
    width: 0.75em;
    height: 0.75em;
  }
</style>
