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
// Normalize title: API expects URL-style (spaces as underscores).
async function getArticleHTML(pageTitle) {
  const apiTitle = pageTitle.trim().replace(/\s+/g, '_');
  const response = await fetch(
    `${WIKI_API}/page/html/${encodeURIComponent(apiTitle)}`,
    { headers: WIKI_HEADERS }
  );
  if (!response.ok) {
    throw new Error(`Wikipedia returned ${response.status} for "${pageTitle}"`);
  }
  // Handle redirects: canonical title is in the Content-Location header
  const canonicalPath = response.headers.get('content-location');
  const canonicalTitle = canonicalPath
    ? decodeURIComponent(canonicalPath.split('/').pop())
    : apiTitle;
  return {
    html: await response.text(),
    canonicalTitle
  };
}


// Renders an article into the #article-frame iframe.
// Intercepts internal Wikipedia links to call navigateTo() instead.
// navigateCallback is a function(pageTitle) provided by game.js
async function loadArticle(pageTitle, navigateCallback) {
  const { html, canonicalTitle } = await getArticleHTML(pageTitle);
  const iframe = document.getElementById('article-frame');
  const doc = iframe.contentDocument;

  doc.open();
  // Use API HTML as-is (it already has <base href="//en.wikipedia.org/wiki/">). No double-wrapping.
  doc.write(html);
  doc.close();

  // Strip script tags — we don't want Wikipedia's JS running
  doc.querySelectorAll('script').forEach(el => el.remove());
  // Strip edit section links — not relevant in our game
  doc.querySelectorAll('.mw-editsection').forEach(el => el.remove());
  // Strip references section for cleaner reading
  doc.querySelectorAll('.reflist').forEach(el => el.remove());

  // Intercept all anchor links inside the iframe so clicks call navigateCallback (count as moves)
  doc.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href') || '';
    let targetTitle = null;
    if (href.startsWith('./')) {
      targetTitle = decodeURIComponent(href.slice(2)).split('#')[0].trim();
    } else if (href.includes('/wiki/')) {
      targetTitle = decodeURIComponent(href.replace(/^.*\/wiki\//, '').split('#')[0].trim());
    } else if (!href.startsWith('http') && !href.startsWith('//') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      targetTitle = decodeURIComponent(href.split('#')[0].trim());
    }
    if (targetTitle) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateCallback(targetTitle);
      });
      link.style.cursor = 'pointer';
    } else {
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
