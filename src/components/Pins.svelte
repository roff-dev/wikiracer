<script lang="ts">
  // Links pinned from the article on screen: tap one to follow it without scrolling back to it.
  // A row above the race bar on phones (at the foot of the window on small computers), a column
  // beside the article on wide screens, where the race keeps the column whether or not anything's
  // pinned, so the first pin doesn't move the text.
  import { displayTitle } from '../data/share';

  let { pins, onfollow, onunpin }: { pins: string[]; onfollow: (to: string, from: Element) => void; onunpin: (to: string) => void } = $props();
</script>

<aside class="pins" aria-label="Pinned links">
  <p class="head">Pinned</p>
  <ul role="list">
    {#each pins as t (t)}
      <li>
        <button class="pin" type="button" onclick={(e) => onfollow(t, e.currentTarget)}>{displayTitle(t)}</button>
        <button class="unpin" type="button" aria-label="Unpin {displayTitle(t)}" onclick={() => onunpin(t)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
        </button>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .pins {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(64px + env(safe-area-inset-bottom));
    z-index: 19;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0 8px var(--gutter);
    border-top: 1px solid var(--line);
    background: var(--bg);
  }
  .head {
    flex: none;
    margin: 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-weight: 600;
  }
  ul {
    display: flex;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0 var(--gutter) 0 0;
    overflow-x: auto;
    list-style: none;
    scrollbar-width: none;
  }
  li {
    display: flex;
    flex: none;
    align-items: center;
    border: 1px solid color-mix(in srgb, var(--link) 40%, transparent);
    border-radius: 999px;
    background: var(--bg);
  }
  .pin,
  .unpin {
    min-height: 40px;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .pin {
    max-width: 16em;
    padding: 0 4px 0 14px;
    overflow: hidden;
    color: var(--link);
    font: 600 var(--size-16) / 1.2 var(--font);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .unpin {
    display: grid;
    place-items: center;
    width: 36px;
    padding: 0;
    border-radius: 999px;
    color: var(--ink-2);
  }
  .pin:hover {
    text-decoration: underline;
  }
  .unpin:hover {
    color: var(--ink);
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
  }

  /* the race bar moves to the top of the window here */
  @media (min-width: 900px) {
    .pins {
      bottom: 0;
    }
  }
  /* beside the article, held in view while it scrolls */
  @media (min-width: 1100px) {
    .pins {
      position: sticky;
      top: 140px;
      bottom: auto;
      align-self: start;
      display: grid;
      align-items: start;
      gap: 10px;
      padding: 24px 0 0;
      border: 0;
      background: none;
    }
    ul {
      display: grid;
      padding: 0;
      overflow: visible;
    }
    li {
      justify-content: space-between;
    }
    .pin {
      flex: 1 1 auto;
      max-width: none;
      min-height: 44px;
      padding: 8px 4px 8px 14px;
      text-align: left;
      white-space: normal;
    }
  }
</style>
