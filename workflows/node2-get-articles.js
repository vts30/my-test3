// NODE 2 — Get Articles
// Paste this into a Code node in n8n
// Receives one source config item, returns today's articles from that source

const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const { id, listUrl, loginUrl, email, password, requiresLogin, source } = $json;

// Today's date YYYY-MM-DD
const today = new Date().toISOString().split('T')[0];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
});

// Helper: accept consent banner
const acceptConsent = async (page) => {
  try {
    await page.waitForSelector(
      '#onetrust-accept-btn-handler, button[title*="Akzeptieren"], .sp-choice-type-11',
      { timeout: 4000 }
    );
    await page.click(
      '#onetrust-accept-btn-handler, button[title*="Akzeptieren"], .sp-choice-type-11'
    );
    await page.waitForTimeout(1000);
  } catch (_) {}
};

try {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });

  // Login if required
  let cookies = [];
  if (requiresLogin) {
    await page.goto(loginUrl, { waitUntil: 'networkidle2' });
    await acceptConsent(page);
    await page.type('input[type=email]',    email,    { delay: 60 });
    await page.type('input[type=password]', password, { delay: 60 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type=submit]'),
    ]);
    cookies = await page.cookies();
  }

  // Navigate to article list
  await page.goto(listUrl, { waitUntil: 'networkidle2' });
  await acceptConsent(page);

  // Wait for Angular render (wiwo only)
  if (id === 'wiwo') {
    await page.waitForSelector('app-default-teaser', { timeout: 10000 });
  }

  let articles = [];

  // ── TAGESSPIEGEL ──────────────────────────────────────────────
  if (id === 'tagesspiegel') {
    articles = await page.$$eval('div.ts-article-tile', tiles =>
      tiles.map(t => {
        const dateRaw = t.querySelector('p.ts-type-base.ts-type-xs')?.innerText?.trim();
        // Convert "19.03.2026" → "2026-03-19"
        const isoDate = dateRaw
          ? dateRaw.split('.').reverse().join('-')
          : null;
        return {
          url:    t.querySelector('a.stretched-link')?.getAttribute('href'),
          title:  t.querySelector('h3.ts-type-h3-alt')?.innerText?.trim(),
          teaser: t.querySelector('div.ts-type-text-md-alt')?.innerText?.trim(),
          topic:  t.querySelector('span.ts-type-text-base-base.text-primary')?.innerText?.trim(),
          type:   t.querySelector('span.badge.text-uppercase.border')?.innerText?.trim(),
          isoDate,
        };
      })
      .filter(a => a.url && a.title)
      .map(a => ({
        ...a,
        url: a.url.startsWith('http')
          ? a.url
          : `https://background.tagesspiegel.de${a.url}`,
      }))
    );

  // ── WIWO ──────────────────────────────────────────────────────
  } else if (id === 'wiwo') {
    articles = await page.$$eval('app-default-teaser', teasers =>
      teasers.map(t => ({
        url:    t.querySelector('a.list-layout')?.getAttribute('href'),
        title:  t.querySelector('h3.bold')?.innerText?.trim(),
        kicker: t.querySelector('div.kicker span:last-child')?.innerText?.trim(),
        teaser: t.querySelector('app-teaser-content-body p')?.innerText?.trim(),
        author: t.querySelector('span.author-names')?.innerText?.trim(),
        isPaid: !!t.querySelector('app-paid-marker'),
        isoDate: null, // not available in list — filtered in scrape node
      }))
      .filter(a => a.url && a.title)
      .map(a => ({ ...a, url: `https://www.wiwo.de${a.url}` }))
    );

  // ── SZ-DOSSIER ────────────────────────────────────────────────
  } else if (id === 'sz-dossier') {
    articles = await page.$$eval('article', items =>
      items.map(a => ({
        url:     a.querySelector('a[href]')?.getAttribute('href'),
        title:   a.querySelector('h3 span')?.innerText?.trim(),
        author:  a.querySelector('p span a')?.innerText?.trim(),
        isoDate: a.querySelector('time')?.getAttribute('datetime') || null,
      }))
      .filter(a => a.url && a.title)
      .map(a => ({ ...a, url: `https://www.sz-dossier.de${a.url}` }))
    );

  // ── CAPITAL ───────────────────────────────────────────────────
  } else if (id === 'capital') {
    articles = await page.$$eval('article.teaser.teaser--list', items =>
      items.map(a => ({
        url:    a.querySelector('a.teaser__link')?.href,
        title:  a.querySelector('span.teaser__headline')?.innerText?.trim(),
        kicker: a.querySelector('span.teaser__kicker')?.innerText?.trim(),
        teaser: a.querySelector('div.teaser__text')?.innerText?.trim(),
        author: a.querySelector('span.teaser-footer__author')?.innerText?.replace('von', '').trim(),
        isPaid: a.dataset.brandIdentifier === 'capital_plus',
        isoDate: a.querySelector('time.teaser__time')
          ?.getAttribute('datetime')?.split('T')[0] || null,
      }))
      .filter(a => a.url && a.title)
    );
  }

  // Filter to today only (wiwo filtered later in scrape node)
  const todayArticles = articles.filter(a => {
    if (id === 'wiwo') return true;
    return a.isoDate && a.isoDate.startsWith(today);
  });

  return todayArticles.map(a => ({
    json: { ...a, cookies, source }
  }));

} finally {
  await browser.close();
}
