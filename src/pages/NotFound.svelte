<script lang="ts">
  // Served with status 404 for any path that isn't a page. The brand mark with its line broken:
  // a start, a finish, and no route between them.
  import Footer from '../components/Footer.svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
</script>

<SiteHeader />
<main class="lost">
  <svg class="mark" viewBox="0 0 220 24" aria-hidden="true">
    <circle class="s" cx="12" cy="12" r="9" />
    <path d="M28 12h56M136 12h56" />
    <path class="gap" d="M100 4l8 16M112 4l8 16" />
    <circle class="f" cx="208" cy="12" r="9" />
    <circle class="fc" cx="208" cy="12" r="4" />
  </svg>
  <h1>There's no page here.</h1>
  <p>The link may be mistyped, or the page may have moved.</p>
  <a class="pill primary" href="/">Go to the home page</a>
</main>
<Footer />

<style>
  .lost {
    max-width: calc(65ch + 2 * var(--gutter));
    min-height: 60svh;
    margin: 0 auto;
    padding: 48px var(--gutter) 72px;
  }
  .mark {
    display: block;
    width: min(100%, 320px);
    height: auto;
    overflow: visible;
  }
  .mark path {
    fill: none;
    stroke: var(--line);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .mark .gap {
    stroke: var(--ink-2);
    stroke-width: 2;
  }
  .s {
    fill: var(--signal);
  }
  .f {
    fill: var(--bg);
    stroke: var(--flare);
    stroke-width: 3;
  }
  .fc {
    fill: var(--flare);
  }
  h1 {
    margin: 40px 0 0;
    font: 780 var(--size-display) / 0.95 var(--font);
    font-stretch: var(--stretch-display);
    letter-spacing: -0.02em;
    text-wrap: balance;
  }
  p {
    margin: 20px 0 32px;
    color: var(--ink-2);
    font-size: var(--size-20);
  }
</style>
