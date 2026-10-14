<script lang="ts">
  // One race article: its title, the attribution line, and the rewritten body. Game links and
  // image credits are handled by one delegated listener on the body. While the next article loads,
  // `article` is null and the title shows from `pending` (the tapped link morphs into it) over
  // skeleton lines (or `note`, when it failed). `onpress` hears a game link pressed (its title) or the press abandoned (null).
  import '../styles/article.css';
  import type { Snippet } from 'svelte';
  import Sheet from './Sheet.svelte';
  import { articleUrl, historyUrl, revisionUrl, type Article } from '../race/article';
  import { imageCredit, filePage, type Credit } from '../wiki/credit';

  let {
    article,
    pending = '',
    onmove,
    onpress,
    note,
  }: {
    article: Article | null;
    pending?: string;
    onmove?: (to: string, from: Element) => void;
    onpress?: (to: string | null) => void;
    // shown under the title: a load error, or a dead end
    note?: Snippet;
  } = $props();

  let root: HTMLDivElement;
  let creditOpen = $state(false);
  let credit = $state<{ file: string; src: string; alt: string; data: Credit | null } | null>(null);

  $effect(() => {
    if (!article) return root.replaceChildren();
    if (!article.body.childNodes.length) return;
    root.replaceChildren(...article.body.childNodes);
    // Images outside game links open their credit, so they take focus like buttons
    for (const img of root.querySelectorAll<HTMLImageElement>('img[data-file]')) {
      // and icons (Wikidata's pencil, flags in tables) are left alone: too small to tap, and
      // their credit isn't what anyone is after
      const w = Number(img.getAttribute('width'));
      if (img.closest('a.race') || (w > 0 && w < 24)) continue;
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', `Image credit${img.alt ? `: ${img.alt}` : ''}`);
    }
  });

  async function showCredit(img: HTMLImageElement) {
    const file = img.dataset.file!;
    credit = { file, src: img.currentSrc || img.src, alt: img.alt, data: null };
    creditOpen = true;
    const data = await imageCredit(file);
    if (credit?.file === file) credit.data = data;
  }

  function act(e: Event) {
    const target = e.target as Element;
    const link = target.closest('a.race, area[data-to]');
    if (link) {
      e.preventDefault();
      onmove?.(link.getAttribute('data-to')!, link);
      return;
    }
    const img = target.closest<HTMLImageElement>('img[data-file][role=button]');
    if (img) {
      e.preventDefault();
      showCredit(img);
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as Element).matches('img[data-file][role=button]')) act(e);
  }

  // The press highlight lands on pointerdown, before the browser's own :active on touch screens
  let pressed: Element | null = null;
  function onpointerdown(e: PointerEvent) {
    pressed = (e.target as Element).closest('a.race');
    pressed?.classList.add('pressed');
    if (pressed) onpress?.(pressed.getAttribute('data-to'));
  }
  // a touch that turned into a scroll: the prefetch started on pointerdown is dropped
  function oncancel() {
    if (pressed) onpress?.(null);
    release();
  }
  function release() {
    pressed?.classList.remove('pressed');
    pressed = null;
  }

  const sourceUrl = $derived(article ? (article.revision ? revisionUrl(article.title, article.revision) : articleUrl(article.title)) : '');
</script>

<article class="view">
  <h1 class="title" class:jump={!article}>{article?.display ?? pending}</h1>
  {#if article}
  <p class="attribution">
    <strong>{article.display}</strong>, from Wikipedia
    (<a href={sourceUrl} target="_blank" rel="noopener">article</a>,
    <a href={historyUrl(article.title)} target="_blank" rel="noopener">history</a>), CC BY-SA 4.0.
    Changed for this game: links rewritten to stay in the race, edit links removed, navigation boxes and
    references collapsed, restyled.
  </p>
  {:else if !note}
    <div class="skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
  {/if}
  {@render note?.()}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="article"
    bind:this={root}
    onclick={act}
    {onkeydown}
    {onpointerdown}
    onpointerup={release}
    onpointercancel={oncancel}
    onpointerleave={release}
  ></div>
</article>

<Sheet bind:open={creditOpen} title="Image credit">
  {#if credit}
    <figure class="credit">
      <img src={credit.src} alt={credit.alt} />
      <figcaption>
        <p class="file">{credit.file.replaceAll('_', ' ')}</p>
        {#if !credit.data}
          <p class="quiet">Looking up who made it…</p>
        {:else}
          <p>{credit.data.author ? `By ${credit.data.author}` : 'The file page names who made it.'}</p>
          {#if credit.data.licence}
            <p>
              {#if credit.data.licenceUrl}<a href={credit.data.licenceUrl} target="_blank" rel="noopener">{credit.data.licence}</a>{:else}{credit.data.licence}{/if}
            </p>
          {/if}
          {#if credit.data.nonFree}
            <p class="quiet">Used on Wikipedia under fair use. It isn't free to reuse.</p>
          {/if}
        {/if}
        <p><a href={credit.data?.filePage ?? filePage(credit.file)} target="_blank" rel="noopener">See the file on Wikipedia</a></p>
      </figcaption>
    </figure>
  {/if}
</Sheet>

<style>
  .view {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 24px var(--gutter) 48px;
  }
  .title {
    margin: 0;
    font-size: clamp(2rem, 9vw, 3.8125rem);
    font-weight: 780;
    font-stretch: var(--stretch-display);
    line-height: 0.98;
    letter-spacing: -0.02em;
    text-wrap: balance;
    overflow-wrap: break-word;
  }
  /* the tapped link morphs into this title (same view-transition name) */
  .title.jump {
    view-transition-name: jump;
  }
  .skeleton {
    display: grid;
    gap: 14px;
    margin: 14px 0 28px;
  }
  .skeleton span {
    height: 1.05em;
    border-radius: 6px;
    background: var(--bg-sunk);
  }
  .skeleton span:first-child {
    width: 60%;
    height: 0.8em;
    margin-bottom: 18px;
  }
  .skeleton span:last-child {
    width: 72%;
  }
  .attribution {
    margin: 14px 0 28px;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
    line-height: 1.45;
  }
  .attribution a,
  .credit a {
    color: var(--ink);
  }
  .credit {
    margin: 0;
  }
  .credit img {
    display: block;
    max-width: 100%;
    max-height: 40dvh;
    border-radius: 12px;
  }
  .credit figcaption {
    margin-top: 12px;
  }
  .credit p {
    margin: 0 0 8px;
  }
  .file {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .quiet {
    color: var(--ink-2);
  }
</style>
