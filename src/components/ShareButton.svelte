<script lang="ts">
  // Share: the native share sheet where there is one, else Copy. If the clipboard is blocked too,
  // the text shows in a box to copy by hand.
  let { text }: { text: string } = $props();

  const canShare = typeof navigator.share === 'function';
  let status = $state('');
  let manual = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      status = 'Copied.';
    } catch {
      manual = true;
      status = '';
    }
  }

  async function share() {
    if (!canShare) return copy();
    try {
      await navigator.share({ text });
    } catch (e) {
      // closing the share sheet isn't an error
      if (!(e instanceof DOMException && e.name === 'AbortError')) await copy();
    }
  }
</script>

<div class="share">
  <button class="pill primary" type="button" onclick={share}>
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {#if canShare}<path d="M10 3v10M6 7l4-4 4 4M4 11v5h12v-5" />{:else}<rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V4H4v9h3" />{/if}
    </svg>
    {canShare ? 'Share' : 'Copy'}
  </button>
  <p class="status" aria-live="polite">{status}</p>
  {#if manual}
    <label class="manual">
      <span>Copy this to share it:</span>
      <textarea readonly rows="4" onfocus={(e) => e.currentTarget.select()}>{text}</textarea>
    </label>
  {/if}
</div>

<style>
  .share {
    display: grid;
    justify-items: start;
    gap: 6px;
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .status {
    min-height: 1.5em;
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .manual {
    display: grid;
    gap: 6px;
    width: 100%;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  textarea {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunk);
    color: var(--ink);
    font: 500 var(--size-16) / 1.4 var(--font);
    resize: none;
  }
  @media (max-width: 599px) {
    .share,
    .pill {
      width: 100%;
    }
    .share {
      justify-items: stretch;
    }
  }
</style>
