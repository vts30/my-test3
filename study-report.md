# n8n News Scraper — Study Report
**Project:** Automated German news article scraping and summarization
**Platform:** n8n on Kubernetes (namespace: preme-n8n)
**Sources:** Tagesspiegel Background, WirtschaftsWoche, SZ-Dossier, Capital

---

## Objective

Build an automated workflow that scrapes daily articles from four German premium news sources (behind paywalls), summarizes them using an LLM, and generates a PDF briefing — all running on Kubernetes with Istio.

---

## Architecture (Final)

```
node1 (source config)
  → node2 (login + article list scraping via Puppeteer)
  → node10 (LLM call — Mistral-Small-24B via vLLM)
  → node10-summary-pdf (PDF generation from LLM response)
  → node4 (PDF generation from raw articles)
```

- **n8n container:** runs the workflow, hosts Chromium, runs code nodes via internal task-runner
- **task-runner sidecar:** present but unused (internal mode chosen for stability)
- **Docker image:** custom `preme-n8n-base:1.0.10` with Puppeteer pre-installed
- **Registry:** Harbor (corporate)

---

## Problems and Solutions

### Problem 1 — Approach: Selenium → TypeScript Custom Node → Puppeteer Code Node

**Journey:**
- Started with **Selenium WebDriver** in Docker → unreliable with corporate proxy, complex session management
- Switched to **TypeScript Custom Node** with HTTP client → could not access paywall content (JavaScript-rendered, requires real browser)
- Final approach: **Puppeteer inside n8n Code nodes** — full browser automation within the workflow itself

**Lesson:** Paywall content on Tagesspiegel is revealed by client-side JavaScript after a subscription check. Only a real browser session (Puppeteer) can access it.

---

### Problem 2 — Puppeteer modules not loading in Code node

**Error:** `Cannot find module 'puppeteer-extra'`

**Root cause:** n8n installs packages to `/install/node_modules` with `NODE_PATH` set, but the internal task-runner runs as a **child subprocess** and does not inherit `NODE_PATH`.

**Solution:** Add symlinks in the Dockerfile from `/install/node_modules` into `/home/node/node_modules` (the default Node.js lookup path):
```dockerfile
RUN ln -s /install/node_modules/puppeteer-extra /home/node/node_modules/puppeteer-extra
RUN ln -s /install/node_modules/puppeteer-extra-plugin-stealth /home/node/node_modules/puppeteer-extra-plugin-stealth
RUN ln -s /install/node_modules/puppeteer-core /home/node/node_modules/puppeteer-core
```

---

### Problem 3 — Istio blocking all outbound traffic (ERR_CONNECTION_RESET)

**Error:** All Chromium page navigations failed with `ERR_CONNECTION_RESET` or SSL errors.

**Root cause:** Istio egress gateway was blocking all outbound HTTP/HTTPS traffic from the pod by default.

**Solution:** Pass the corporate proxy to Chromium at launch:
```javascript
args: ['--proxy-server=http://corporate-proxy:port']
```
Chromium routes all traffic through the proxy, which is allowed by Istio.

---

### Problem 4 — Consent banner (Usercentrics shadow DOM)

**Problem:** The cookie consent button is inside a shadow DOM tree — standard `querySelector` cannot find it.

**Solution:** Recursive shadow DOM traversal in `page.evaluate()`:
```javascript
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
```

---

### Problem 5 — waitForFunction causes runner to hang

**Problem:** Using `page.waitForFunction()` in n8n Code nodes caused the task-runner to hang indefinitely and timeout.

**Root cause:** `waitForFunction` uses polling inside the browser context. When run inside the n8n internal task-runner subprocess, it conflicts with the runner's event loop and causes a deadlock.

**Solution:** Replace all `waitForFunction` calls with fixed `setTimeout` waits:
```javascript
// Instead of waitForFunction
await new Promise(r => setTimeout(r, 2000));
```

This applies everywhere — consent banner, article content waiting, page load checks.

---

### Problem 6 — External runner: login form rejects keyboard input

**Problem:** After switching to external task-runner mode, the Tagesspiegel login form accepted the email/password visually but the fields stayed empty on submit.

**Root cause:** `page.type()` generates keyboard events with `isTrusted: false` in the external runner environment. The login form's JavaScript validation rejects untrusted keyboard events.

**Solution:** Use the native `HTMLInputElement` value setter via `page.evaluate()`:
```javascript
await page.evaluate((val) => {
  const input = document.querySelector('input[type=email]');
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeSetter.call(input, val);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, email);
```

---

### Problem 7 — Blank PDF (no text visible)

**Problem:** PDF was generated by Puppeteer but appeared completely blank — only CSS borders were visible, no text.

**Root cause:** The Alpine Linux Kubernetes container has **no system fonts installed**. Chromium rendered text as invisible (zero-width glyphs).

**Solution:** Replace Puppeteer-based PDF generation with **pure Node.js PDF generation** using PDF Type1 built-in fonts (Helvetica/Helvetica-Bold). These fonts are part of the PDF specification and require no system fonts:
- CP1252 encoding handles all German characters (ä, ö, ü, ß, „ etc.)
- Glyph width table enables accurate text measurement and word wrapping
- PDF assembled manually with correct xref table and object offsets
- No external dependencies — works in any container

---

### Problem 8 — n8n binary data format

**Problem:** PDF binary was returned as `pdfBuffer.toString('base64')` but n8n could not process it as a file.

**Solution:** Use the correct n8n helper:
```javascript
const binaryData = await this.helpers.prepareBinaryData(buf, fileName, 'application/pdf');
return [{ binary: { data: binaryData } }];
```

---

### Problem 9 — Article title extraction from h1

**Problem:** Title was extracted using `titleEl.innerText` which included the topic/kicker span text concatenated with the title.

**Root cause:** The Tagesspiegel `<h1>` contains a `<span>` for the topic label and a raw text node for the title. `innerText` returns both merged.

**Solution:** Extract only the raw text nodes (nodeType 3), skipping child elements:
```javascript
const title = [...(titleEl?.childNodes || [])]
  .filter(n => n.nodeType === 3)
  .map(n => n.textContent.trim())
  .filter(Boolean)
  .join(' ');
```

---

## Key Technical Learnings

| Topic | Learning |
|---|---|
| n8n Code nodes | `waitForFunction` must never be used — use `setTimeout` instead |
| n8n external runner | `console.log` does not work — use `throw new Error('msg')` for debugging |
| n8n binary data | Must use `this.helpers.prepareBinaryData()`, not manual base64 |
| n8n multi-item PDF | Use `$input.all()` in the PDF node to combine all items into one PDF |
| Kubernetes + Istio | Outbound traffic blocked by default — corporate proxy required for Chromium |
| Docker image | Internal task-runner subprocess does not inherit `NODE_PATH` — use symlinks |
| Paywall scraping | Must reuse the same authenticated browser session across article pages |
| PDF in containers | Never use Chromium for PDF rendering in minimal Linux containers — no fonts |
| Shadow DOM | Standard `querySelector` cannot traverse shadow roots — recursive helper needed |

---

## Final Workflow Summary

1. **node1** — defines source configs (URLs, credentials, proxy settings)
2. **node2** — logs into each source, scrapes article list, scrapes full article content in same browser session
3. **node4** — generates a combined PDF of all raw articles (pure Node.js)
4. **node10** — calls vLLM API (Mistral-Small-24B) to generate executive summary
5. **node10-summary-pdf** — renders the LLM markdown response into a PDF (handles `##`, `**bold**`, `- bullets`)
