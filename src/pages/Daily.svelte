<script lang="ts">
  // /daily/: today's card and a Play button, rendered in place (no redirect), so the link can be
  // shared and bookmarked as "today's course".
  import DailyCard from '../components/DailyCard.svelte';
  import Footer from '../components/Footer.svelte';
  import SiteHeader from '../components/SiteHeader.svelte';
</script>

<SiteHeader />
<main class="daily">
  <DailyCard>
    {#snippet actions({ href })}
      <div class="go">
        <a class="pill primary" {href}>Play</a>
        <a class="pill secondary" href="/">More ways to play</a>
      </div>
    {/snippet}
  </DailyCard>
</main>
<Footer />

<style>
  .daily {
    max-width: 1180px;
    margin: 0 auto;
    padding: 16px var(--gutter) 72px;
  }
  .go {
    display: grid;
    gap: 12px;
    margin-top: 32px;
  }
  .go .primary {
    font-size: var(--size-20);
  }
  @media (min-width: 900px) {
    .daily {
      padding-top: 32px;
    }
    .go {
      display: flex;
      flex-wrap: wrap;
    }
    .go .primary {
      min-width: 200px;
    }
  }
</style>
