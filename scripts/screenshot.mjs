import { chromium } from 'playwright-core';
const OUT = '/home/user/blurb/docs/screenshots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text().slice(0, 200)); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.screenshot({ path: OUT + '/01-heatmap.png' });

// add-layer modal, then Esc to close (keyboard path)
await page.locator('.cp-layers-head .chip.mini').click();
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/07-add-layer-modal.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const modalGone = (await page.locator('.modal').count()) === 0;
console.log('esc closes modal:', modalGone);

// hover a cell (no click) -> tooltip + radar hover state
await page.mouse.move(950, 500);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/05-radar-hover.png' });

// click a cell, park mouse off-map, capture selected state
await page.mouse.click(880, 450);
await page.waitForTimeout(1600);
await page.mouse.move(260, 700);
await page.waitForTimeout(1400);
await page.screenshot({ path: OUT + '/02-radial.png' });

// Esc deselects
await page.keyboard.press('Escape');
await page.waitForTimeout(1400);
const chipGone = (await page.locator('.score-chip').count()) === 0;
console.log('esc deselects cell:', chipGone);

// re-select for remaining states
await page.mouse.click(880, 450);
await page.waitForTimeout(1600);

// collapse dock
await page.locator('.dock-collapse').click();
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/06-dock-collapsed.png' });
await page.locator('.dock-tab').click();
await page.waitForTimeout(500);

// remove a layer -> broken weights
await page.locator('.lc-remove').first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + '/03-broken-weights.png' });

// auto-balance back
await page.locator('.eb-btn.primary').click();
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '/04-autobalanced.png' });
await browser.close();
console.log('done');
