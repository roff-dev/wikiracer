<script lang="ts">
  import { PROFILE_URL } from '../site';
</script>

<footer class="footer">
  <nav aria-label="Site">
    <a href={PROFILE_URL}>Made by Kieron</a>
    <a href="/about/">About</a>
    <a href="/privacy/">Privacy</a>
    <a href="/terms/">Terms</a>
  </nav>
  <p>Articles from Wikipedia, used under CC BY-SA 4.0. Wikiracer isn't affiliated with Wikipedia or the Wikimedia Foundation.</p>
</footer>

<style>
  .footer {
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px var(--gutter) calc(32px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0 8px;
    margin-inline: -6px;
    margin-bottom: 4px;
  }
  /* 44 px tall targets without making the footer look padded */
  nav a {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    min-height: 44px;
    padding: 0 6px;
    color: var(--ink);
    font-weight: 600;
  }
  p {
    margin: 0;
    max-width: 60ch;
  }
</style>
