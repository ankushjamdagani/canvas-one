import { expect, test, type Page } from '@playwright/test';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

test('comments rest as bubbles, open on hover, stay open on click, change colour and render markdown', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);

  await page.getByTestId('dock-note-btn').click();
  const input = page.getByTestId('dock-note-input');
  await input.fill('plain');
  // Toolbar bold wraps the selection; then enter the rest as Markdown.
  await input.selectText();
  await page.getByTestId('note-format-bold').click();
  await expect(input).toHaveValue('**plain**');
  await input.fill('**plain**\n- item one\n- [docs](https://example.com/x)');
  await input.press('Enter');
  await waitForIdle(page);

  // Auto-collapsed to a bubble once editing ends and the pointer is away.
  const bubble = page.locator('[data-open]').first();
  const bubbleButton = page.locator('[data-testid^="note-bubble-"]').first();
  await page.mouse.move(5, 300);
  await expect(bubbleButton).toBeVisible();
  await expect(page.locator('.note-card')).toHaveCount(0);

  // Hover opens; moving away closes again.
  await bubble.hover();
  const card = page.locator('.note-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('strong')).toHaveText('plain');
  await expect(card.locator('li')).toHaveCount(2);
  await expect(card.locator('a')).toHaveAttribute('href', 'https://example.com/x');
  await page.waitForTimeout(400);
  await page.mouse.move(5, 300);
  await expect(page.locator('.note-card')).toHaveCount(0);

  // Click keeps it open after the pointer leaves, until collapsed.
  await bubble.click();
  await page.mouse.move(5, 300);
  await expect(page.locator('.note-card')).toHaveCount(1);

  // Colour change persists on the note.
  await page.locator('.note-card').first().getByTestId(/note-color-btn-/).click();
  await page.getByTestId(/note-color-sky-/).click();
  await waitForIdle(page);
  await expect(page.locator('.note-card').first()).toHaveClass(/bg-note-sky/);

  await page.locator('.note-card').first().getByTestId(/note-collapse-btn-/).click();
  await page.mouse.move(5, 300);
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('[data-testid^="note-bubble-"]').first()).toHaveClass(/bg-note-sky/);
});
