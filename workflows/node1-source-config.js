// NODE 1 — Source Config
// Paste this into a Code node in n8n
// Returns one item per source to process

return [
  {
    json: {
      id: 'tagesspiegel',
      listUrl:       'https://background.tagesspiegel.de/digitalisierung-und-ki',
      loginUrl:      'https://background.tagesspiegel.de/login',
      email:         process.env.TS_EMAIL,
      password:      process.env.TS_PASSWORD,
      requiresLogin: true,
      source:        'tagesspiegel',
    }
  },
  {
    json: {
      id:            'wiwo',
      listUrl:       'https://www.wiwo.de/politik/deutschland/',
      requiresLogin: false,
      source:        'wiwo',
    }
  },
  {
    json: {
      id:            'sz-dossier',
      listUrl:       'https://www.sz-dossier.de/dossiers/digitalwende',
      requiresLogin: false,
      source:        'sz-dossier',
    }
  },
  {
    json: {
      id:            'capital',
      listUrl:       'https://www.capital.de/wirtschaft-politik/',
      requiresLogin: false,
      source:        'capital',
    }
  },
];
