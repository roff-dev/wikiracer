<script lang="ts">
  import TextPage from './TextPage.svelte';
  import { mapDateText } from '../site';
</script>

<TextPage title="About Wikiracer">
  <p class="lead">I built Wikiracer to play with friends and to find out, after every race, how close I'd come to the shortest route.</p>

  <h2>The game</h2>
  <p>You get a start article and a finish article on Wikipedia. Get from one to the other by tapping links in the articles, in as few clicks as you can. There's no going back and no searching inside a page: you read, pick a link, and live with it.</p>
  <p>Race today's course, pick a difficulty and get a surprise, set your own course, or race up to three friends in a live room or through a challenge link.</p>

  <h2>The reveal</h2>
  <p>When you finish, my map of Wikipedia's links searches outwards from both ends at once until the two searches meet. You watch that happen, then the shortest route draws itself next to yours, along with how many equally short routes there are.</p>
  <p>The map holds about 7.2 million articles and 713 million links between them, taken from Wikipedia's public database dumps. It's from {mapDateText} and I refresh it about once a month, so a link added to Wikipedia since then can be in an article you read but not in my map. The map is stored as static files, and your browser reads only the small pieces it needs for each search.</p>

  <h2>Credits</h2>
  <ul>
    <li>Articles, images and descriptions come from <a href="https://en.wikipedia.org/">Wikipedia</a>, used under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Every article in a race links back to its page on Wikipedia, and each image's credit is a tap away. Wikiracer isn't affiliated with Wikipedia or the Wikimedia Foundation.</li>
    <li>The typeface is <a href="https://github.com/github/mona-sans">Mona Sans</a>, by GitHub, under the SIL Open Font License.</li>
    <li>The code is on <a href="https://github.com/roff-dev/wikiracer">GitHub</a>.</li>
  </ul>

  <h2>Get in touch</h2>
  <p>If something breaks, or a course seems wrong, <a href="https://github.com/roff-dev/wikiracer/issues">open an issue on GitHub</a> and I'll take a look.</p>
</TextPage>
