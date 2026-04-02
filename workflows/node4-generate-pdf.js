// NODE 4 — Generate PDF
// Paste this into a Code node in n8n
// Receives one scraped article, returns binary PDF

const puppeteer = require('puppeteer-extra');

const { title, body, lead, teaser, author, source, url, published, topic } = $json;
const content = body || lead || teaser || '';

const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 40px;
      line-height: 1.6;
      color: #222;
    }
    h1 {
      font-size: 22px;
      margin-bottom: 8px;
    }
    .meta {
      color: #666;
      font-size: 12px;
      margin-bottom: 16px;
      border-bottom: 1px solid #ddd;
      padding-bottom: 8px;
    }
    .lead {
      font-weight: bold;
      margin-bottom: 16px;
      font-size: 15px;
    }
    .topic {
      color: #0066cc;
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .body {
      font-size: 14px;
    }
  </style>
</head>
<body>
  ${topic ? '<div class="topic">' + topic + '</div>' : ''}
  <h1>${title || ''}</h1>
  <div class="meta">
    ${source || ''}
    ${author ? '· ' + author : ''}
    ${published ? '· ' + published : ''}
    ${url ? '· <a href="' + url + '">' + url + '</a>' : ''}
  </div>
  ${lead ? '<div class="lead">' + lead + '</div>' : ''}
  <div class="body">${content.replace(/\n/g, '<br>')}</div>
</body>
</html>
`;

const browser = await puppeteer.launch({
  executablePath: '/usr/lib/chromium/chromium',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ],
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });

  const fileName = `${(source || 'article')}-${(title || 'article').slice(0, 40)}.pdf`
    .replace(/[^a-zA-Z0-9\-_.]/g, '_');

  return [{
    json: { ...$json },
    binary: {
      pdf: await this.helpers.prepareBinaryData(
        Buffer.from(pdfBuffer),
        fileName,
        'application/pdf'
      )
    }
  }];
} finally {
  await browser.close();
}
