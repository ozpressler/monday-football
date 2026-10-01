'use strict';
// Developer tool: prints every distinct piece of UI text the crawler sees (English mode), to build/verify translations.
//   node tests/crawl-dump.js            -> all strings
//   node tests/crawl-dump.js he         -> only strings still containing English letters when Hebrew is on
const { crawlLocal, crawlCloud, HEBREW_NAMES } = require('./crawl');
(async () => {
  const lang = process.argv[2] || '';
  const all = new Map();
  for (const m of [await crawlLocal(lang), await crawlCloud(lang)]) for (const [k, v] of m) if (!all.has(k)) all.set(k, v);
  const names = new Set(HEBREW_NAMES);
  const out = [...all].filter(([s]) => /[A-Za-z]{2,}/.test(s)).map(([s, step]) => ({ s, step }));
  console.log(JSON.stringify(out, null, 1));
  console.error(`${out.length} strings with English letters (of ${all.size} total)`);
})().catch(e => { console.error(e); process.exit(1); });
