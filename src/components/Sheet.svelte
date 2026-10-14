<script lang="ts">
  // A modal sheet: rises from the bottom on phones, a centred panel from 900 px. Built on
  // <dialog>, so focus, Escape and the inert background come from the browser.
  import type { Snippet } from 'svelte';

  let { open = $bindable(false), title, children }: { open?: boolean; title: string; children: Snippet } = $props();
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-label={title}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <div class="inner">
    <header>
      <h2>{title}</h2>
      <button class="close" type="button" aria-label="Close" onclick={() => dialog.close()}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
    </header>
    {@render children()}
  </div>
</dialog>

<style>
  .sheet {
    width: 100%;
    max-width: none;
    max-height: 85dvh;
    margin: auto 0 0;
    padding: 0;
    border: 0;
    border-radius: 20px 20px 0 0;
    background: var(--bg);
    color: var(--ink);
    box-shadow: var(--shadow-sheet);
  }
  .sheet::backdrop {
    background: rgb(7 8 15 / 0.45);
  }
  .sheet[open] {
    animation: rise 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .inner {
    padding: 8px var(--gutter) calc(24px + env(safe-area-inset-bottom));
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
  }
  h2 {
    margin: 0;
    font-size: var(--size-20);
    font-weight: 680;
    font-stretch: var(--stretch-heading);
  }
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: 0 -10px 0 auto;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--ink-2);
    cursor: pointer;
  }
  .close:hover {
    background: var(--bg-sunk);
    color: var(--ink);
  }
  .close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }
  @media (min-width: 900px) {
    .sheet {
      width: min(480px, calc(100vw - 48px));
      margin: auto;
      border-radius: 20px;
    }
    .inner {
      padding: 8px 24px 24px;
    }
  }
  @keyframes rise {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet[open] {
      animation: none;
    }
  }
</style>
