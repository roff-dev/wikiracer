<script lang="ts">
  import { PROFILE_URL } from '../site';
</script>

<footer class="footer">
  <p><a href={PROFILE_URL}>Made by Kieron</a></p>
  <p>Articles from Wikipedia, used under CC BY-SA 4.0. Wikiracer isn't affiliated with Wikipedia or the Wikimedia Foundation.</p>
</footer>

<style>
  .footer {
    max-width: 1180px;
    margin: 0 auto;
    padding: 32px var(--gutter) calc(32px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    color: var(--ink-2);
    font-size: var(--size-13);
    font-stretch: var(--stretch-data);
  }
  p {
    margin: 0 0 6px;
    max-width: 60ch;
  }
  a {
    color: var(--ink);
    font-weight: 600;
  }
</style>
