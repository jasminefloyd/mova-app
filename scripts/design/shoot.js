// Screenshot docs/design/screens/html/*.html to screens/png at 390x844 @2x, offline. Usage: node shoot.js <docs_design_dir>
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path');
(async () => {
  const dir = path.resolve(process.argv[2]);
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'screens/manifest.json'), 'utf8'));
  fs.mkdirSync(path.join(dir, 'screens/png'), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const external = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file:')) return r.continue(); external.push(u); return r.abort(); });
  const page = await ctx.newPage();
  for (const s of list) {
    await page.goto('file://' + path.join(dir, s.html));
    await page.evaluate(() => document.fonts.ready);
    const bad = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'error').map(f => f.family + f.weight));
    if (bad.length) throw new Error('font error ' + s.id + bad);
    await page.screenshot({ path: path.join(dir, s.png), clip: { x: 0, y: 0, width: 390, height: 844 } });
  }
  await browser.close();
  if (external.length) { console.log('external requests blocked:', [...new Set(external)]); process.exit(1); }
  console.log('shot', list.length);
})();
