<script lang="ts">
  // The top bar on home and the daily page: the wordmark, About, and the menu (the theme).
  import { getTheme, setTheme, type Theme } from '../data/theme';

  let theme = $state<Theme>(getTheme());
  const pick = (t: Theme) => (setTheme(t), (theme = t));
</script>

<header class="top">
  <a class="wordmark" href="/">
    <svg viewBox="0 0 28 12" aria-hidden="true"><path d="M5 6h18" /><circle class="s" cx="5" cy="6" r="3.5" /><circle class="f" cx="23" cy="6" r="3.5" /></svg>wikiracer</a>
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
</header>

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 1180px;
    margin: 0 auto;
    padding: calc(10px + env(safe-area-inset-top)) var(--gutter) 10px;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin-right: auto;
    font-size: var(--size-20);
  }
  .wordmark svg {
    width: 28px;
    height: 12px;
  }
  .wordmark path {
    stroke: var(--line);
    stroke-width: 2;
  }
  .wordmark .s {
    fill: var(--signal);
  }
  .wordmark .f {
    fill: var(--flare);
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
    inset: calc(60px + env(safe-area-inset-top)) 12px auto auto;
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
    min-height: 40px;
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
