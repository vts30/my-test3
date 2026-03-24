// NODE 3 — Scrape Article
// Paste this into a Code node in n8n
// Receives one article item, returns full article content

const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const { url, cookies, source, isPaid, proxy } = $json;

// Today in German format for wiwo date check e.g. "19.03.2026"
const now     = new Date();
const todayDE = `${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}.${now.getFullYear()}`;

const proxyServer = proxy || '';
const browser = await puppeteer.launch({
  executablePath: '/usr/lib/chromium/chromium',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--ignore-certificate-errors',
    ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
  ],
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
});

try {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });

  // Restore authenticated session cookies
  if (cookies?.length) await page.setCookie(...cookies);

  // For tagesspiegel: click the article link from the list page instead of direct goto
  if (source === 'tagesspiegel') {
    await page.goto('https://background.tagesspiegel.de/digitalisierung-und-ki', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    const clicked = await page.evaluate((targetUrl) => {
      const link = [...document.querySelectorAll('a.stretched-link')].find(a => a.href === targetUrl);
      if (link) { link.click(); return true; }
      return false;
    }, url);
    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  let article = {};

  // ── TAGESSPIEGEL ──────────────────────────────────────────────
  if (source === 'tagesspiegel') {
    article = await page.evaluate(() => {
      const titleEl = document.querySelector('h1.ts-type-h2-alt');
      const topic   = titleEl?.querySelector('span.ts-type-text-md-base')?.innerText?.trim();
      const title   = titleEl?.innerText?.replace(topic || '', '').trim();
      const lead    = document.querySelector('section.ts-article-intro p.ts-type-alt-bold-lg')?.innerText?.trim();
      const body    = document.querySelector('div.ts-page-main-content.ts-paywall-content')?.innerText?.trim();
      const author  = document.querySelector('p.ts-type-author')?.innerText?.replace('von', '').trim();
      const published = document.querySelector('time')?.getAttribute('datetime');
      const tags    = [...document.querySelectorAll('div.ts-related-tags div.ts-tags a')]
                        .map(a => a.innerText.trim());
      return { topic, title, lead, body, author, published, tags, isPaywalled: false };
    });

  // ── WIWO ──────────────────────────────────────────────────────
  } else if (source === 'wiwo') {
    await page.waitForSelector('app-header-content-headline', { timeout: 10000 });

    article = await page.evaluate(() => {
      const paywallEl = document.querySelector('app-storyline-element.hmg-paywalled');
      const allParas  = [...document.querySelectorAll('app-storyline-paragraph hmg-rich-text.editorial div p')];
      const freeParas = paywallEl
        ? allParas.filter(p => !paywallEl.contains(p))
        : allParas;

      return {
        title:       document.querySelector('app-header-content-headline')?.innerText?.trim(),
        kicker:      document.querySelector('app-header-content-kicker span:not(.hidden)')?.innerText?.replace(':', '').trim(),
        lead:        document.querySelector('app-header-content-lead-text')?.innerText?.trim(),
        author:      document.querySelector('app-authors a')?.innerText?.trim(),
        published:   document.querySelector('app-story-date')?.innerText?.trim(),
        body:        freeParas.map(p => p.innerText.trim()).filter(Boolean).join('\n\n'),
        isPaywalled: !!paywallEl,
      };
    });

    // Date filter — skip if not today
    if (article.published && !article.published.includes(todayDE)) {
      return [];
    }

  // ── SZ-DOSSIER ────────────────────────────────────────────────
  } else if (source === 'sz-dossier') {
    article = await page.evaluate(() => ({
      type:        document.querySelector('p.text-sz-12')?.innerText?.trim(),
      title:       document.querySelector('h1')?.innerText?.trim(),
      date:        document.querySelector('time[datetime]')?.getAttribute('datetime'),
      author:      document.querySelector('p.text-sz-15-spaniel.font-bold')
                     ?.innerText?.replace('Von', '').trim(),
      preview:     [...document.querySelectorAll('p.max-w-prose')]
                     .map(p => p.innerText.trim()).filter(Boolean).join('\n\n'),
      isPaywalled: !!document.querySelector('a[href*="/auth/login"]'),
    }));

  // ── CAPITAL ───────────────────────────────────────────────────
  } else if (source === 'capital') {
    article = await page.evaluate(() => ({
      kicker:      document.querySelector('span.title__kicker')?.innerText?.trim(),
      title:       document.querySelector('span.title__headline')?.innerText?.trim(),
      author:      document.querySelector('a.authors__list-link')?.innerText?.trim(),
      date:        document.querySelector('time[datetime]')?.getAttribute('datetime'),
      lead:        document.querySelector('div.intro')?.innerText?.trim(),
      tags:        [...document.querySelectorAll('ul.tags a.tags__link')]
                     .map(a => a.innerText.trim()),
      isPaywalled: !!document.querySelector('ws-paywall'),
    }));
  }

  return [{ json: { ...article, url, source } }];

} finally {
  await browser.close();
}
