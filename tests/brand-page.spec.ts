import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public chrome and theme controls stay consistent across landing and brand', async ({page}) => {
  const chrome = async () => page.locator('header').first().evaluate((header) => {
    const wordmark = header.querySelector('.brand-wordmark')!;
    const logo = wordmark.previousElementSibling!;
    const theme = header.querySelector('[data-testid="theme-trigger"]')!;
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return {width:r.width,height:r.height,y:r.y}; };
    return { font:getComputedStyle(wordmark).font,wordmark:rect(wordmark),logo:rect(logo),theme:rect(theme) };
  });
  await page.goto('/');
  await page.evaluate(()=>document.fonts.ready);
  const landing = await chrome();
  await page.getByTestId('theme-trigger').click();
  const themeFont = await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).fontFamily);
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Brand',exact:true}).click();
  await expect(page.locator('[data-page="brand"]')).toBeVisible();
  await expect.poll(chrome).toEqual(landing);
  await page.getByTestId('theme-trigger').click();
  expect(await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).fontFamily)).toBe(themeFont);
  await page.getByRole('button',{name:'Dark',exact:true}).click();
  await page.keyboard.press('Escape');
  const mode = await page.evaluate(()=>document.querySelector<HTMLElement>('.canvas-one-root')!.dataset.themeMode);
  expect(mode).toBe('dark');
  await page.getByRole('link',{name:'Canvas One',exact:true}).click();
  expect(await page.evaluate(()=>document.querySelector<HTMLElement>('.canvas-one-root')!.dataset.themeMode)).toBe(mode);
});

test('brand background stays viewport sized and offscreen faces are idle', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/brand');
  await expect.poll(()=>page.locator('#states').getAttribute('data-in-view')).toBe('false');
  const raster = await page.getByTestId('route-board').locator('canvas').evaluate((canvas: HTMLCanvasElement)=>({height:canvas.height,limit:innerHeight*Math.min(devicePixelRatio,3)}));
  expect(raster.height).toBeLessThanOrEqual(raster.limit);
  expect(await page.locator('#states .canvas-one-face *').evaluateAll(els=>els.every(el=>getComputedStyle(el).animationName==='none'))).toBe(true);
  await page.locator('#states').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('#states').getAttribute('data-in-view')).toBe('true');
  await page.locator('[data-page="brand"]').evaluate(el=>el.scrollTo(0,0));
  await page.getByRole('link',{name:'Canvas One',exact:true}).click();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
});

test('brand header stays inside the frame when scrolling and projects show only their owner', async ({page}) => {
  await page.goto('/brand');
  const header = page.locator('.public-header');
  await expect(header.getByRole('link', {name:'Try Beta'})).toBeVisible();
  await expect(header.locator('.lp-collaborators')).toHaveCount(0);
  await page.locator('#states').scrollIntoViewIfNeeded();
  const bounds = await header.boundingBox();
  expect(bounds!.y).toBe(23);
  expect(bounds!.x).toBe(23);
  expect(bounds!.x + bounds!.width).toBe(1512 - 23);
  await expect(header.getByTestId('theme-trigger')).toBeVisible();
  await page.goto('/projects');
  await expect(header.getByRole('link', {name:'Try Beta'})).toHaveCount(0);
  await expect(header.locator('[aria-label^="Local workspace:"]')).toBeVisible();
  await expect(header.locator('.lp-collaborators')).toHaveCount(0);
});

test('theme is the last header control and links have a quiet underline hover', async ({page}) => {
  for (const route of ['/', '/brand', '/projects']) {
    await page.goto(route);
    await expect(page.locator('.public-header nav > :last-child')).toHaveAttribute('data-testid', 'theme-trigger');
    const link = page.locator('.public-header').getByRole('link', {name:'Brand', exact:true});
    await link.hover();
    expect(await link.evaluate(el=>getComputedStyle(el).textDecorationLine)).toBe('underline');
    expect(await link.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  }
});

test('brand is linked from both public headers and survives reload and history', async ({page}) => {
  await page.goto('/');
  await page.getByRole('link', {name:'Brand', exact:true}).click();
  await expect(page).toHaveURL(/\/brand$/);
  await expect(page.getByRole('heading', {level:1})).toContainText('brand guidelines.');
  await page.reload();
  await expect(page.getByRole('heading', {name:'Expressions', exact:true})).toBeAttached();
  await page.goBack();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await page.goto('/projects');
  await page.getByRole('link', {name:'Brand', exact:true}).click();
  await expect(page.getByRole('heading', {level:1})).toContainText('Canvas One');
  await page.getByRole('link', {name:'Try Beta'}).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('expression selection synchronizes live specimens and pause freezes the flow', async ({page}) => {
  await page.clock.install();
  await page.goto('/brand');
  await page.getByRole('button', {name:'Working', exact:true}).click();
  await expect(page.getByRole('button', {name:'Working', exact:true})).toHaveAttribute('aria-pressed','true');
  const targets = ['.brand-player-display', '.brand-board > header .brand-status', '.brand-board .brand-cursor-tag', '.brand-board .brand-ai-avatar', '.brand-board .brand-prompt'];
  await page.clock.runFor(900);
  for(const target of targets) {
    const faces = page.locator(target+' .canvas-one-face');
    for (const face of await faces.all()) await expect(face).toHaveAttribute('data-expression','squint');
  }
  await page.getByRole('button',{name:'Play flow',exact:true}).click();
  await page.clock.runFor(2000);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play flow',exact:true})).toBeVisible();
  const label = await page.locator('.brand-player-display .brand-status').innerText();
  await page.clock.runFor(10000);
  await expect(page.locator('.brand-player-display .brand-status')).toHaveText(label);
});

test('manual state changes blink and terminal expressions settle without losing their label', async ({page}) => {
  await page.clock.install();
  await page.goto('/brand');
  await page.locator('#transitions').scrollIntoViewIfNeeded();
  await page.clock.runFor(1000);
  const large = page.locator('.brand-player-display > .canvas-one-face');
  for (const [name, expression] of [['Thinking','wink'],['Reading the board','look'],['Working','squint'],['Checking','pixel'],['Brainstorming','thought'],['Suggestion ready','reply'],['Chat','round'],['Connecting','antenna'],['Listening','listen'],['Your turn','wait'],['Offline','sleep'],['Empty board','empty'],['Done','happy'],['Error','error']] as const) {
    await page.getByRole('button',{name,exact:true}).click();
    await page.clock.runFor(20);
    await expect(large).toHaveAttribute('data-closing','true');
    await page.clock.runFor(1000);
    await expect(large).toHaveAttribute('data-expression',expression);
    await expect(large).toHaveAttribute('data-closing','false');
    if (expression === 'happy' || expression === 'error') {
      await page.clock.runFor(1600);
      await expect(large).toHaveAttribute('data-expression','base');
      await expect(page.locator('.brand-player-display .brand-status')).toHaveText(name);
    }
  }
});

test('rapid expression requests complete the blink and hold the latest displayed face', async ({page}) => {
  await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
  await page.goto('/brand');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.locator('#transitions').scrollIntoViewIfNeeded();
  await page.clock.runFor(1000);
  const face = page.locator('.brand-player-display > .canvas-one-face');
  await page.getByRole('button',{name:'Thinking',exact:true}).click();
  await page.clock.runFor(20);
  await expect(face).toHaveAttribute('data-closing','true');
  await page.getByRole('button',{name:'Reading the board',exact:true}).click();
  await page.clock.runFor(20);
  await expect(face).toHaveAttribute('data-closing','true');
  await expect(face).toHaveAttribute('data-expression','base');
  await page.clock.runFor(160);
  await expect(face).toHaveAttribute('data-expression','look');
  await expect(face).toHaveAttribute('data-closing','false');
  await page.getByRole('button',{name:'Working',exact:true}).click();
  await page.clock.runFor(400);
  await expect(face).toHaveAttribute('data-expression','look');
  await expect(face).toHaveAttribute('data-closing','false');
  await page.clock.runFor(650);
  await expect(face).toHaveAttribute('data-expression','squint');
  await expect(face).toHaveAttribute('data-closing','false');
});

test('working progress is enclosed and the app prompt belongs to chat', async ({page}) => {
  await page.goto('/brand');
  await page.locator('#loading').scrollIntoViewIfNeeded();
  const progress = page.getByRole('progressbar',{name:'Example grouping progress'});
  const enclosure = progress.locator('..');
  expect(await enclosure.evaluate(el=>parseFloat(getComputedStyle(el).borderRadius))).toBe(9);
  expect(await progress.evaluate(el=>{const p=el.getBoundingClientRect(),r=el.parentElement!.getBoundingClientRect();return p.left>=r.left&&p.right<=r.right&&p.top>=r.top&&p.bottom<=r.bottom;})).toBe(true);
  await expect(page.locator('.brand-chat .brand-prompt')).toHaveCount(1);
  await expect(page.locator('.brand-workspace .brand-prompt')).toHaveCount(0);
});

for (const width of [1440, 800, 390, 320]) test(`${width}px: brand sections stay inside the frame with accessible reflow`, async ({page},info) => {
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/brand');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByRole('heading',{level:2})).toHaveCount(10);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId('theme-trigger').click();
  const menu = await page.getByTestId('theme-popover').boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(23);
  expect(menu!.y).toBeGreaterThanOrEqual(23);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(width - 23);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(900 - 23);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation',{name:'Brand guidelines sections'})).toHaveCount(0);
  await page.getByRole('heading',{name:'Expressions',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Expressions',exact:true})).toBeInViewport();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`brand-${width}.png`)});
});
