<script lang="ts">
  // The top bar across the window: the wordmark top left; About and the menu (the theme) top right,
  // or the wordmark alone (plain) on the race, result, room and challenge pages.
  import Wordmark from './Wordmark.svelte';
  import { getTheme, setTheme, type Theme } from '../data/theme';

  let { plain = false }: { plain?: boolean } = $props();

  let theme = $state<Theme>(getTheme());
  const pick = (t: Theme) => (setTheme(t), (theme = t));
</script>

<header class="top">
  <Wordmark />
  {#if !plain}
  <a class="about" href="/about/">About</a>
  <button class="menu-btn" type="button" popovertarget="site-menu" aria-label="Menu">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
  </button>
  <div id="site-menu" class="menu" popover="auto">
    <a class="item" href="/about/">About</a>
    <fieldset class="themes">
      <legend>Theme</legend>
      {#each [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']] as const as [value, name] (value)}
        <label><input type="radio" name="site-theme" {value} checked={theme === value} onchange={() => pick(value)} />{name}</label>
      {/each}
    </fieldset>
  </div>
  {/if}
</header>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: calc(64px + env(safe-area-inset-top));
    /* the full width of the window, not the page column: the wordmark top left, the menu top
       right, and the menu opens under its button */
    padding: calc(10px + env(safe-area-inset-top)) max(var(--edge), env(safe-area-inset-right)) 10px max(var(--edge), env(safe-area-inset-left));
  }
  /* the wordmark takes the free space, so About and the menu sit at the right */
  .top > :global(.wordmark) {
    margin-right: auto;
  }
  .about {
    display: none;
    align-items: center;
    min-height: 44px;
    padding: 0 12px;
    font-weight: 600;
    text-decoration: none;
  }
  .about:hover {
    text-decoration: underline;
  }
  .menu-btn {
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
  .menu-btn:hover {
    background: var(--bg-sunk);
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
    /* under the button, its right edge on the header's */
    inset: calc(60px + env(safe-area-inset-top)) max(var(--edge), env(safe-area-inset-right)) auto auto;
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
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 12px;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
  }
  .item:hover {
    background: var(--bg-sunk);
  }
  .themes {
    display: grid;
    margin: 4px 0 0;
    padding: 8px 12px 4px;
    border: 0;
    border-top: 1px solid var(--line);
  }
  legend {
    float: left;
    margin-bottom: 4px;
    color: var(--ink-2);
    font-size: var(--size-13);
  }
  .themes label {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    cursor: pointer;
  }
  input {
    accent-color: var(--signal);
  }
  @media (min-width: 900px) {
    .about {
      display: inline-flex;
    }
  }
</style>
