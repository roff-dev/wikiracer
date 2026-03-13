// js/wikipedia.js
// All Wikipedia API interactions and article rendering


const WIKI_API = 'https://en.wikipedia.org/api/rest_v1';
const WIKI_HEADERS = {
  'Api-User-Agent': 'WikiRacer/1.0 (dev@example.com)'
};


// Fetches a random Wikipedia page summary.
// Returns { title, url } where url uses underscores (e.g. 'Nikola_Tesla')
async function getRandomPage() {
  const response = await fetch(
    `${WIKI_API}/page/random/summary`,
    { headers: WIKI_HEADERS }
  );
  const data = await response.json();
  // Avoid disambiguation pages by re-rolling
  if (data.type === 'disambiguation') {
    return getRandomPage();
  }
  return {
    title: data.title,
    url: data.title.replace(/ /g, '_')
  };
}


// Fetches the full HTML of a Wikipedia article.
// Returns { html, canonicalTitle } — canonicalTitle handles redirects.
async function getArticleHTML(pageTitle) {
  const response = await fetch(
    `${WIKI_API}/page/html/${encodeURIComponent(pageTitle)}`,
    { headers: WIKI_HEADERS }
  );
  // Handle redirects: canonical title is in the Content-Location header
  const canonicalPath = response.headers.get('content-location');
  const canonicalTitle = canonicalPath
    ? decodeURIComponent(canonicalPath.split('/').pop())
    : pageTitle;
  return {
    html: await response.text(),
    canonicalTitle
  };
}


// Renders an article into the #article-container div.
// Intercepts internal Wikipedia links to call navigateTo() instead.
// navigateCallback is a function(pageTitle) provided by game.js
async function loadArticle(pageTitle, navigateCallback) {
  const { html, canonicalTitle } = await getArticleHTML(pageTitle);
  const container = document.getElementById('article-container');
  container.innerHTML = html;


  // Strip script tags — we don't want Wikipedia's JS running
  container.querySelectorAll('script').forEach(el => el.remove());
  // Strip edit section links — not relevant in our game
  container.querySelectorAll('.mw-editsection').forEach(el => el.remove());
  // Strip references section for cleaner reading
  container.querySelectorAll('.reflist').forEach(el => el.remove());


  // Intercept all anchor links
  container.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    // Wikipedia internal links start with './'
    if (href && href.startsWith('./')) {
      const targetTitle = decodeURIComponent(href.slice(2)).split('#')[0];
      if (!targetTitle) return; // Anchor-only link, ignore
      link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateCallback(targetTitle);
      });
      link.style.cursor = 'pointer';
    } else {
      // External links open in new tab, not counted as clicks
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });


  // Return canonicalTitle so game.js can update Firebase if redirected
  return canonicalTitle;
}


// Normalises a Wikipedia title for comparison.
// Handles underscores vs spaces, capitalisation, URL encoding.
function normaliseTitle(title) {
  return decodeURIComponent(title)
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
}
