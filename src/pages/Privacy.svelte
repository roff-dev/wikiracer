<script lang="ts">
  import TextPage from './TextPage.svelte';
  import { PROFILE_URL } from '../site';
</script>

<TextPage title="Privacy" updated="16 October 2026">
  <p class="lead">This site is made and run by me, <a href={PROFILE_URL}>roff-dev</a>. There are no accounts, no ads and no tracking cookies, and I don't sell or share anything about you.</p>

  <h2>What stays on your device</h2>
  <p>A few things are kept in your browser's local storage so the site remembers them between visits. They never leave your device unless the list below says so, and clearing your browser's site data removes them.</p>
  <ul>
    <li><code>wikiracer.theme</code>: light, dark or your system's setting.</li>
    <li><code>wikiracer.tier</code>: how detailed the map animation can be on your device.</li>
    <li><code>wikiracer.finished</code>: the courses you've finished, so a shared result can show its routes straight away.</li>
    <li><code>wikiracer.daily</code>: your daily course results (clicks and time), for your streak and best result.</li>
    <li><code>wikiracer.name</code>: the nickname you last used in a room or challenge.</li>
    <li><code>wikiracer.seats</code>: a random token for each room or challenge you've joined, so a reload keeps your seat. The server only ever sees a hash of it.</li>
  </ul>
  <p>A race in progress is kept in session storage until you close the tab, so a reload resumes it.</p>

  <h2>Rooms and challenges</h2>
  <p>When you create or join a room or a challenge, the server stores, for that room only: its start and finish articles, when it was created, each player's nickname and seat-token hash, each move (the article and the time), and the results. Other players in the same room see the nicknames, click counts and results. It doesn't store your IP address or browser details.</p>
  <p>Everything for a room or challenge is deleted 30 days after its last activity.</p>

  <h2>Who your browser talks to</h2>
  <ul>
    <li><strong>Cloudflare</strong> hosts the site and runs the room server. To serve pages it processes your IP address, and it keeps short-lived logs of requests to the room server that I can see for up to 3 days. I use <a href="https://www.cloudflare.com/web-analytics/">Cloudflare Web Analytics</a> to count page views: it sets no cookies and doesn't track you across sites. See <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.</li>
    <li><strong>Cloudflare Turnstile</strong> checks that a person, not a script, is creating a room or challenge. Its script loads only when you open Race with friends, and it may set a cookie on challenges.cloudflare.com that's needed for that check (a strictly necessary cookie, so the site doesn't ask for consent).</li>
    <li><strong>Wikipedia</strong> serves the articles, title search and short descriptions straight to your browser, so the Wikimedia Foundation sees those requests. See the <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Wikimedia privacy policy</a>.</li>
    <li><strong>GitHub Pages</strong> serves the files of my map of Wikipedia's links, which your browser reads when a race ends. GitHub sees those requests. See <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.</li>
  </ul>

  <h2>Children</h2>
  <p>There's no sign-up and nothing to give except an optional nickname, so the site doesn't ask for your age. Please don't put your real name or anything personal in a nickname.</p>

  <h2>Your rights and questions</h2>
  <p>Under UK data protection law you can ask what I hold about you and ask me to delete it. Since rooms only know a nickname, tell me the room code and the nickname you used. <a href="https://github.com/roff-dev/wikiracer/issues">Open an issue on GitHub</a> for anything about privacy; if you'd rather not post the details publicly, say so in the issue and I'll arrange a private way to talk.</p>
  <p>If I change this page, the date at the top changes too.</p>
</TextPage>
