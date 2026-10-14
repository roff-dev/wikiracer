<script lang="ts">
  // The brand mark (start and finish joined by a line) and the name, linking home. One element, so
  // the logo looks and sits the same on every page.
</script>

<a class="wordmark" href="/">
  <svg viewBox="0 0 28 12" aria-hidden="true"><path d="M5 6h18" /><circle class="s" cx="5" cy="6" r="3.5" /><circle class="f" cx="23" cy="6" r="3.5" /></svg>wikiracer</a>

<style>
  .wordmark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    font-size: var(--size-20);
  }
  svg {
    width: 28px;
    height: 12px;
  }
  path {
    stroke: var(--line);
    stroke-width: 2;
  }
  .s {
    fill: var(--signal);
  }
  .f {
    fill: var(--flare);
  }
</style>
