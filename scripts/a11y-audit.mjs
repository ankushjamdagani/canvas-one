// Accessibility audit: runs axe (WCAG 2.0/2.1/2.2 A and AA rules) over the main app states
// at desktop and phone sizes against a production build, and prints violations by rule.
// Usage: npm run build && node scripts/a11y-audit.mjs [--json out.json]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const PORT = 5260;
const BASE = `http://127.0.0.1:${PORT}/`;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const idle = (p) =>
  p.waitForFunction(() => document.querySelector('[data-testid="save-status"]')?.getAttribute('data-state') === 'idle', null, { timeout: 15000 });
const open = async (p, id) => {
  await p.getByTestId(`create-example-${id}`).click();
  await p.getByTestId('workspace-root').waitFor();
  await idle(p);
  await p.waitForTimeout(400);
};

const states = {
  entry: async (p) => p.getByTestId('entry-screen-root').waitFor(),
  workspace: (p) => open(p, 's05'),
  inspector: async (p) => { await open(p, 's04'); await p.locator('.component-node').nth(1).click(); await p.waitForTimeout(400); },
  picker: async (p) => { await open(p, 's05'); await p.getByTestId('dock-component-btn').click(); await p.getByTestId('library-picker').waitFor(); },
  library: async (p) => {
    await open(p, 's05'); await p.getByTestId('dock-component-btn').click();
    await p.getByTestId('library-picker-full-library-btn').click(); await p.getByTestId('library-panel').waitFor();
  },
  history: async (p) => { await open(p, 's05'); await p.getByTestId('topbar-history-btn').click(); await p.getByTestId('history-ladder').waitFor(); await p.waitForTimeout(300); },
  projectMenu: async (p) => { await open(p, 's05'); await p.getByTestId('breadcrumb-project-btn').click(); await p.getByTestId('project-menu-popover').waitFor(); },
  quickOptions: async (p) => { await open(p, 's05'); await p.getByTestId('topbar-quick-options-btn').click(); await p.getByTestId('quick-options').waitFor(); },
  scenarioSwitcher: async (p) => { await open(p, 's05'); await p.getByTestId('scenario-switcher-trigger').click(); await p.getByTestId('scenario-switcher-popover').waitFor(); },
  scenarioEditor: async (p) => {
    await open(p, 's04'); await p.getByTestId('scenario-switcher-trigger').click();
    await p.getByRole('button', { name: /^Edit / }).click(); await p.waitForTimeout(600);
  },
  results: async (p) => {
    await open(p, 's04'); await p.getByTestId('scenario-run-btn').click();
    await p.getByTestId('results-status-badge').filter({ hasText: 'completed' }).waitFor({ timeout: 20000 });
    await p.getByTestId('results-details-toggle').click(); await p.waitForTimeout(300);
  },
};
const viewports = { desktop: { width: 1512, height: 982 }, phone: { width: 390, height: 844 } };

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const browser = await chromium.launch();
  const byRule = new Map();
  for (const [vp, size] of Object.entries(viewports)) {
    for (const [name, run] of Object.entries(states)) {
      const context = await browser.newContext({ viewport: size, ...(vp === 'phone' ? { hasTouch: true, isMobile: true } : {}) });
      const page = await context.newPage();
      await page.goto(BASE);
      await page.getByTestId('entry-screen-root').waitFor();
      try { await run(page); } catch (e) { console.log(`JOURNEY FAIL ${vp}/${name}: ${e.message.split('\n')[0]}`); }
      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const v of result.violations) {
        const entry = byRule.get(v.id) ?? { id: v.id, impact: v.impact, help: v.help, states: new Set(), nodes: new Map() };
        entry.states.add(`${vp}/${name}`);
        for (const n of v.nodes) {
          const key = n.target.join(' ');
          if (!entry.nodes.has(key)) entry.nodes.set(key, n.failureSummary?.split('\n').slice(1, 2).join(' ').trim() ?? '');
        }
        byRule.set(v.id, entry);
      }
      await context.close();
    }
  }
  await browser.close();
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rules = [...byRule.values()].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
  if (!rules.length) console.log('No axe violations.');
  for (const r of rules) {
    console.log(`\n[${r.impact}] ${r.id} — ${r.help}  (${r.nodes.size} elements; ${[...r.states].join(', ')})`);
    for (const [target, why] of [...r.nodes].slice(0, 6)) console.log(`   ${target}  ${why}`);
  }
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(rules.map((r) => ({ ...r, states: [...r.states], nodes: [...r.nodes] })), null, 2));
} finally {
  server.kill();
}
