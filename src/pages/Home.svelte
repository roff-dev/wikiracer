<script lang="ts">
  // Home, in progress: the course setter is built; today's course, Surprise me, rooms, classic
  // courses and the demo loop come with the home page step.
  import Footer from '../components/Footer.svelte';
  import Setter from '../components/Setter.svelte';
</script>

<main class="page">
  <a class="wordmark" href="/">wikiracer</a>
  <h1>Wikiracer</h1>
  <section class="set" aria-labelledby="set-head">
    <h2 id="set-head">Set a course</h2>
    <Setter />
  </section>
</main>
<Footer />

<style>
  .set {
    margin-top: 48px;
  }
  h2 {
    margin: 0 0 16px;
    font-size: var(--size-25);
    font-weight: 700;
    font-stretch: var(--stretch-heading);
  }
</style>
