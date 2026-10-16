<script lang="ts">
  import TextPage from './TextPage.svelte';
  import { PROFILE_URL } from '../site';
</script>

<TextPage title="Terms" updated="16 October 2026">
  <p class="lead">Wikiracer is a free game made and run by me, <a href={PROFILE_URL}>roff-dev</a>. By using it you agree to these terms.</p>

  <h2>Using the site</h2>
  <ul>
    <li>Play fairly with the people you race. Rooms and challenges are among people who know each other, and the game trusts you.</li>
    <li>Don't try to overload, break or get around the site's limits, including the checks on creating rooms and challenges.</li>
    <li>Nicknames must not be offensive, impersonate someone or contain anyone's personal details. I may remove a room or challenge that breaks this.</li>
  </ul>

  <h2>Wikipedia's content</h2>
  <p>Articles, images and descriptions come from Wikipedia and stay under their own licences, mostly <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Each article links to its page on Wikipedia, and each image's credit is shown with it. I don't edit their content beyond turning links that don't count in the game into plain text. Wikiracer isn't affiliated with Wikipedia or the Wikimedia Foundation.</p>

  <h2>No guarantees</h2>
  <p>The site is provided as it is, without warranties. My map of Wikipedia's links is a snapshot, so the shortest route it shows can differ from what the live articles allow. Rooms can rest when a daily limit is reached, and parts of the site can be unavailable. I can change or stop the site at any time. As far as the law allows, I'm not liable for any loss from using it. Nothing here affects your rights as a consumer that can't be limited by law.</p>

  <h2>Changes and law</h2>
  <p>If I change these terms, the date at the top changes too. These terms are governed by the law of England and Wales.</p>
  <p>Questions: <a href="https://github.com/roff-dev/wikiracer/issues">open an issue on GitHub</a>.</p>
</TextPage>
