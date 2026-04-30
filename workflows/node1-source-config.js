// NODE 1 — Source Config
// Paste this into a Code node in n8n
// Returns one item per source to process
//
// ── CONFIG — update credentials and proxy here ────────────────────────────────
const PROXY = process.env.SCRAPER_PROXY || process.env.HTTPS_PROXY || "";
const TS_EMAIL = process.env.TS_EMAIL || "mpulak2508@gmail.com";
const TS_PASSWORD = process.env.TS_PASSWORD || "Test12345";
// set to true for external runner, false for internal runner
const USE_NATIVE_SETTER = true;
// ─────────────────────────────────────────────────────────────────────────────

return [
  {
    json: {
      id: "tagesspiegel",
      listUrl: "https://background.tagesspiegel.de/digitalisierung-und-ki",
      loginUrl: "https://background.tagesspiegel.de/login",
      email: TS_EMAIL,
      password: TS_PASSWORD,
      requiresLogin: true,
      source: "tagesspiegel",
      proxy: PROXY,
      useNativeSetter: USE_NATIVE_SETTER,
    },
  },
  {
    json: {
      id: "wiwo",
      listUrl: "https://www.wiwo.de/politik/deutschland/",
      requiresLogin: false,
      source: "wiwo",
      proxy: PROXY,
      useNativeSetter: USE_NATIVE_SETTER,
    },
  },
  {
    json: {
      id: "sz-dossier",
      listUrl: "https://www.sz-dossier.de/dossiers/digitalwende",
      requiresLogin: false,
      source: "sz-dossier",
      proxy: PROXY,
      useNativeSetter: USE_NATIVE_SETTER,
    },
  },
  {
    json: {
      id: "capital",
      listUrl: "https://www.capital.de/wirtschaft-politik/",
      requiresLogin: false,
      source: "capital",
      proxy: PROXY,
      useNativeSetter: USE_NATIVE_SETTER,
    },
  },
];
