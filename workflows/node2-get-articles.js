// NODE 2 — Get Articles
// Paste this into a Code node in n8n
// Receives one source config item, returns today's articles from that source
// For tagesspiegel: also scrapes full article content in the same browser session

const puppeteer = require('puppeteer-extra');
const Stealth   = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

const { id, listUrl, loginUrl, email, password, requiresLogin, source, proxy, useNativeSetter } = $json;

// Today's date YYYY-MM-DD
const today = new Date().toISOString().split('T')[0];

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
  ignoreHTTPSErrors: true,
  defaultViewport: { width: 1280, height: 800 },
});

// Helper: accept consent banner (Usercentrics uses shadow DOM)
const acceptConsent = async (page) => {
  // Wait up to 5s for banner to appear, then click — no fixed pre-wait
  await page.waitForFunction(() => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const elem of root.querySelectorAll('*')) {
        if (elem.shadowRoot) {
          const found = findInShadow(elem.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    return !!(findInShadow(document, '#accept') ||
              findInShadow(document, 'button[data-action-type="accept"]'));
  }, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const elem of root.querySelectorAll('*')) {
        if (elem.shadowRoot) {
          const found = findInShadow(elem.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const btn = findInShadow(document, '#accept') ||
                findInShadow(document, 'button[data-action-type="accept"]');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));
};

try {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(0);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });

  // Login if required
  if (requiresLogin) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await acceptConsent(page);

    if (useNativeSetter) {
      // External runner: use native value setter (page.type keyboard events are untrusted)
      await page.evaluate((val) => {
        const input = document.querySelector('input[type=email]');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, email);
      await page.evaluate((val) => {
        const input = document.querySelector('input[type=password]');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(input, val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, password);
    } else {
      // Internal runner: standard page.type works
      await page.click('input[type=email]');
      await page.type('input[type=email]',    email,    { delay: 60 });
      await page.click('input[type=password]');
      await page.type('input[type=password]', password, { delay: 60 });
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('button[type=submit]'),
    ]);
  }

  // Navigate to article list
  await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
  await acceptConsent(page);

  // Wait for Angular render (wiwo only)
  if (id === 'wiwo') {
    await page.waitForSelector('app-default-teaser', { timeout: 10000 });
  }

  let articles = [];

  // ── TAGESSPIEGEL ──────────────────────────────────────────────
  if (id === 'tagesspiegel') {
    const allArticles = await page.$$eval('div.ts-article-tile', tiles =>
      tiles.map(t => {
        const dateRaw = t.querySelector('p.ts-type-base.ts-type-xs')?.innerText?.trim();
        const isoDate = dateRaw ? dateRaw.split('.').reverse().join('-') : null;
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

    const todayArticles = allArticles.filter(a => a.isoDate && a.isoDate.startsWith(today));

    // Scrape each article in the same authenticated browser session
    const scrapedArticles = [];
    for (const a of todayArticles) {
      const artPage = await browser.newPage();
      artPage.setDefaultNavigationTimeout(0);
      await artPage.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
      try {
        await artPage.goto(a.url, { waitUntil: 'domcontentloaded' });
        await artPage.waitForSelector('h1.ts-type-h2-alt', { timeout: 10000 }).catch(() => {});
        await artPage.waitForFunction(
          () => (document.querySelector('div.ts-page-main-content.ts-paywall-content')?.innerText?.trim()?.length || 0) > 10,
          { timeout: 15000 }
        ).catch(() => {});
        const content = await artPage.evaluate(() => {
          const titleEl  = document.querySelector('h1.ts-type-h2-alt');
          const topic    = titleEl?.querySelector('span.ts-type-text-md-base')?.innerText?.trim();
          const title    = [...(titleEl?.childNodes || [])]
                             .filter(n => n.nodeType === 3)
                             .map(n => n.textContent.trim())
                             .filter(Boolean)
                             .join(' ')
                             .trim();
          const lead     = document.querySelector('section.ts-article-intro p.ts-type-alt-bold-lg')?.innerText?.trim();
          const body     = document.querySelector('div.ts-page-main-content.ts-paywall-content')?.innerText?.trim();
          const author   = document.querySelector('p.ts-type-author')?.innerText?.replace('von', '').trim();
          const published = document.querySelector('time')?.getAttribute('datetime');
          const tags     = [...document.querySelectorAll('div.ts-related-tags div.ts-tags a')]
                             .map(el => el.innerText.trim());
          return { topic, title, lead, body, author, published, tags, isPaywalled: false };
        });
        scrapedArticles.push({ json: { ...a, ...content, url: a.url, source, scraped: true } });
      } finally {
        await artPage.close();
      }
    }

    return scrapedArticles;

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
        isoDate: null,
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
    json: { ...a, source }
  }));

} finally {
  await browser.close();
}
