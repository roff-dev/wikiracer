<script lang="ts">
  // About, privacy and terms: one column of 65 characters, all Mona Sans, the site header and footer.
  import type { Snippet } from 'svelte';
  import Footer from '../components/Footer.svelte';
  import SiteHeader from '../components/SiteHeader.svelte';

  let { title, updated, children }: { title: string; updated?: string; children: Snippet } = $props();
</script>

<SiteHeader />
<main class="text">
  <h1>{title}</h1>
  {#if updated}<p class="updated">Last updated {updated}</p>{/if}
  {@render children()}
</main>
<Footer />

<style>
  .text {
    max-width: calc(65ch + 2 * var(--gutter));
    margin: 0 auto;
    padding: 24px var(--gutter) 72px;
    font-size: var(--size-16);
    line-height: 1.6;
  }
  h1 {
    margin: 24px 0 0;
    font: 780 var(--size-display) / 0.95 var(--font);
    font-stretch: var(--stretch-display);
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  .updated {
    margin: 16px 0 0;
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
  }
  .text :global(h2) {
    margin: 44px 0 0;
    font-size: var(--size-20);
    font-weight: 700;
    font-stretch: var(--stretch-heading);
    line-height: 1.25;
  }
  .text :global(p),
  .text :global(ul) {
    margin: 14px 0 0;
  }
  .text :global(.lead) {
    margin-top: 32px;
    font-size: var(--size-20);
    line-height: 1.45;
  }
  .text :global(ul) {
    padding-left: 1.2em;
  }
  .text :global(li + li) {
    margin-top: 8px;
  }
  .text :global(a) {
    font-weight: 600;
    text-decoration-thickness: 1.5px;
  }
  .text :global(code) {
    font: inherit;
    font-weight: 600;
    font-stretch: var(--stretch-data);
  }
</style>
