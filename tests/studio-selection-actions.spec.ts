import { expect, test, type Page } from './fixtures';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

// Notes rest as comment bubbles; a click keeps one open.
async function openNotes(page: Page) {
  const bubbles = page.locator('[data-open="false"]');
  while ((await bubbles.count()) > 0) {
    await bubbles.first().click();
  }
}

test.describe('Studio selection actions and note dock (RV-04e)', () => {
  test('aligns, groups, undoes, and adds a note through registry commands', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const first = page.locator('.component-node').nth(0);
    const second = page.locator('.component-node').nth(1);
    await first.click();
    await second.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    await page.getByTestId('selection-align-btn').click();
    await page.getByTestId('selection-align-left').click();
    await waitForIdle(page);
    const firstAfterAlign = await first.boundingBox();
    const secondAfterAlign = await second.boundingBox();
    expect(firstAfterAlign).not.toBeNull();
    expect(secondAfterAlign).not.toBeNull();
    expect(Math.abs(firstAfterAlign!.x - secondAfterAlign!.x)).toBeLessThan(0.5);

    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Checkout entry');
    await groupInput.press('Enter');
    await waitForIdle(page);
    await expect(page.locator('.group-boundary', { hasText: 'Checkout entry' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(page.locator('.group-boundary', { hasText: 'Checkout entry' })).toHaveCount(0);

    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('Watch the payment retry budget');
    await noteInput.press('Enter');
    await waitForIdle(page);
    await openNotes(page);
    await expect(page.locator('.note-card', { hasText: 'Watch the payment retry budget' })).toBeVisible();
  });

  test('Delete key and Quick options delete the selection through the registry', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    // "Checkout" is referenced by S05's scenarios, so every delete path shows
    // the dependency confirmation first (deletePlan.ts).
    const checkout = page.locator('.component-node', { hasText: 'Checkout' });
    await checkout.click();
    await expect(page.getByTestId('selection-count')).toHaveText('1 PART');

    // Quick options lists the registry command with its key hint and runs it.
    await page.getByTestId('topbar-quick-options-btn').click();
    const row = page.getByTestId('quick-option-selection.delete');
    await expect(row).toContainText('Delete selection');
    await expect(row).toContainText('Delete');
    await row.click();
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
    await expect(checkout).toHaveCount(1);

    // Delete and Backspace on canvas focus take the same command.
    for (const key of ['Delete', 'Backspace']) {
      await checkout.click();
      await page.keyboard.press(key);
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
      await expect(checkout).toHaveCount(1);
    }

    // Editable fields never delete: typing Backspace in the note input is native.
    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('abc');
    await noteInput.press('Backspace');
    await expect(noteInput).toHaveValue('ab');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
  });

  test('wraps two nodes in a refinement boundary and restores them with one undo', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const queue = page.locator('.component-node', { hasText: 'Fulfillment queue' });
    const worker = page.locator('.component-node', { hasText: 'Fulfillment worker' });
    await queue.click();
    await worker.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    await page.getByTestId('selection-wrap-btn').click();
    const input = page.getByTestId('selection-wrap-input');
    await input.fill('Async fulfilment');
    await input.press('Enter');
    await waitForIdle(page);

    const frame = page.getByTestId(/boundary-frame-/).filter({ hasText: 'Async fulfilment' });
    await expect(frame).toBeVisible();
    await expect(queue).toBeVisible();
    await expect(worker).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(frame).toHaveCount(0);
    await expect(queue).toBeVisible();
    await expect(worker).toBeVisible();
  });

  test('edits note inline, toggles node port expansion, and dismisses popovers on canvas click', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    // 1. Add a note and verify inline editing
    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('Initial note text');
    await noteInput.press('Enter');
    await waitForIdle(page);
    await openNotes(page);

    const noteCard = page.locator('.note-card').first();
    await expect(noteCard).toBeVisible();
    await expect(noteCard).toContainText('Initial note text');

    // Inline edit note
    const editBtn = noteCard.getByTestId(/note-edit-btn-/);
    await editBtn.click();
    const inlineInput = noteCard.locator('textarea');
    await expect(inlineInput).toBeVisible();
    await inlineInput.fill('Updated note text inline');
    await inlineInput.press('Enter');
    await waitForIdle(page);
    await expect(noteCard).toContainText('Updated note text inline');

    // 2. Node card port expand/collapse toggle
    const checkoutNode = page.locator('.component-node', { hasText: 'Checkout' });
    await expect(checkoutNode).toBeVisible();
    const expandToggle = checkoutNode.getByTestId(/node-expand-toggle-/);
    await expect(expandToggle).toBeVisible();
    await expandToggle.click();
    await waitForIdle(page);
    // Port summary is visible when expanded
    await expect(checkoutNode.locator('[aria-label="Port summary"]')).toBeVisible();
    // Collapse again
    await expandToggle.click();
    await waitForIdle(page);
    await expect(checkoutNode.locator('[aria-label="Port summary"]')).toHaveCount(0);

    // 3. Transient dismissal on canvas pane click
    await page.getByTestId('dock-more-btn').click();
    await expect(page.getByTestId('dock-more-popover')).toBeVisible();
    // Click on canvas pane to dismiss
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    await expect(page.getByTestId('dock-more-popover')).toBeHidden();

    // 4. Delete note
    const noteToDelete = page.locator('.note-card', { hasText: 'Updated note text inline' });
    const deleteBtn = noteToDelete.getByTestId(/note-delete-btn-/);
    await deleteBtn.click();
    await waitForIdle(page);
    await expect(noteToDelete).toHaveCount(0);

    // 5. Area / marquee box selection across nodes
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    await expect(page.getByTestId('selection-count')).toHaveCount(0);

    const firstNode = page.locator('.component-node').nth(0);
    const secondNode = page.locator('.component-node').nth(1);
    const box1 = await firstNode.boundingBox();
    const box2 = await secondNode.boundingBox();
    if (box1 && box2) {
      const minX = Math.min(box1.x, box2.x) - 20;
      const minY = Math.min(box1.y, box2.y) - 20;
      const maxX = Math.max(box1.x + box1.width, box2.x + box2.width) + 20;
      const maxY = Math.max(box1.y + box1.height, box2.y + box2.height) + 20;

      await page.mouse.move(minX, minY);
      await page.mouse.down();
      await page.mouse.move(maxX, maxY, { steps: 5 });
      await page.mouse.up();
      await waitForIdle(page);
      await expect(page.getByTestId('selection-count')).toBeVisible();
      await expect(page.getByTestId('selection-count')).toContainText('PARTS');
    }
  });

  test('sticky notes linking, drag-and-drop from dock, and detachment', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    // 1. Drag and drop note button from dock onto canvas
    const dockNoteBtn = page.getByTestId('dock-note-btn');
    await expect(dockNoteBtn).toBeVisible();

    const canvasPane = page.locator('.react-flow__pane');
    const canvasBox = await canvasPane.boundingBox();
    expect(canvasBox).not.toBeNull();

    // Use HTML5 drag-and-drop dataTransfer dispatch onto canvas
    await dockNoteBtn.dispatchEvent('dragstart', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('application/x-system-studio-note', 'note');
        return dt;
      }),
    });

    await canvasPane.dispatchEvent('dragover', {
      clientX: (canvasBox?.x ?? 0) + 300,
      clientY: (canvasBox?.y ?? 0) + 200,
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('application/x-system-studio-note', 'note');
        return dt;
      }),
    });

    await canvasPane.dispatchEvent('drop', {
      clientX: (canvasBox?.x ?? 0) + 300,
      clientY: (canvasBox?.y ?? 0) + 200,
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('application/x-system-studio-note', 'note');
        return dt;
      }),
    });
    await waitForIdle(page);

    // Verify note appeared on canvas
    const noteCard = page.locator('.note-card').first();
    await expect(noteCard).toBeVisible();

    // 2. Unattached note has "Link to node" button
    const linkBtn = noteCard.getByTestId(/note-link-btn-/);
    await expect(linkBtn).toBeVisible();
    await linkBtn.click();

    // Check link menu options
    const linkMenu = noteCard.getByTestId(/note-link-menu-/);
    await expect(linkMenu).toBeVisible();

    // Link to the first available component option
    const firstOption = linkMenu.locator('button').first();
    const optionText = await firstOption.innerText();
    await firstOption.click();
    await waitForIdle(page);

    // 3. Note is now sticky and displays sticky indicator with component label
    const attachedIndicator = noteCard.getByTestId(/note-attached-indicator-/);
    await expect(attachedIndicator).toBeVisible();
    await expect(attachedIndicator).toContainText(`Sticky: ${optionText}`);

    // 4. Detach note via detach button
    const detachBtn = noteCard.getByTestId(/note-detach-btn-/);
    await expect(detachBtn).toBeVisible();
    await detachBtn.click();
    await waitForIdle(page);

    // Detached indicator should be gone, "Link to node" should be back
    await expect(attachedIndicator).toHaveCount(0);
    await expect(noteCard.getByTestId(/note-link-btn-/)).toBeVisible();
  });

  test('align menu sections, group option visibility, and ungrouping', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');

    // 1. Select 1 node: NEITHER Group NOR Ungroup should be visible
    await nodes.nth(0).click();
    await waitForIdle(page);
    await expect(page.getByTestId('selection-group-btn')).toHaveCount(0);
    await expect(page.getByTestId('selection-ungroup-btn')).toHaveCount(0);
    await expect(page.getByTestId('dock-group-btn')).toHaveCount(0);

    // 2. Select 2 nodes: ONLY Group should be visible (NOT Ungroup)
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await waitForIdle(page);
    await expect(page.getByTestId('selection-group-btn')).toBeVisible();
    await expect(page.getByTestId('selection-ungroup-btn')).toHaveCount(0);

    // 3. Check Align menu sections and tooltips
    await page.getByTestId('selection-align-btn').click();
    const alignMenu = page.locator('[role="menu"]');
    await expect(alignMenu).toBeVisible();
    await expect(alignMenu).toContainText('Horizontal Alignment');
    await expect(alignMenu).toContainText('Vertical Alignment');
    await expect(alignMenu).toContainText('Distribute');

    // Hover align-left icon button and verify tooltip
    const alignLeftBtn = page.getByTestId('selection-align-left');
    await expect(alignLeftBtn).toBeVisible();
    await alignLeftBtn.hover();
    await expect(page.getByRole('tooltip', { name: 'Align left' })).toBeVisible();

    // Close menu with Escape
    await page.keyboard.press('Escape');
    await waitForIdle(page);

    // 4. Group the two nodes
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await waitForIdle(page);
    await page.getByTestId('selection-group-btn').click();
    await page.getByTestId('selection-group-input').fill('Test Cluster');
    await page.getByTestId('selection-group-input').press('Enter');
    await waitForIdle(page);

    const boundary = page.locator('.group-boundary', { hasText: 'Test Cluster' });
    await expect(boundary).toBeVisible();

    // Clear selection by clicking empty canvas
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toHaveCount(0);

    // 5. Click the group container header: selects all nodes in the group
    await boundary.locator('span', { hasText: 'Test Cluster' }).click();
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toBeVisible();
    await expect(page.getByTestId('selection-count')).toContainText('2 PARTS');

    // Exactly 1 option available: Ungroup is visible, Group is NOT visible
    await expect(page.getByTestId('selection-ungroup-btn')).toBeVisible();
    await expect(page.getByTestId('selection-group-btn')).toHaveCount(0);

    // 6. Ungroup via GroupNode ungroup button
    const groupUngroupBtn = page.getByTestId(/group-ungroup-/);
    await expect(groupUngroupBtn).toBeVisible();
    await groupUngroupBtn.click();
    await waitForIdle(page);

    // Group boundary is now removed (ungrouped)
    await expect(boundary).toHaveCount(0);
  });

  test('treats sticky notes as first-class selection items: mixed selection, alignment, duplication, deletion, and grouping', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    // 1. Add a sticky note
    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('Note Alpha');
    await noteInput.press('Enter');
    await waitForIdle(page);
    await openNotes(page);

    const note = page.locator('.note-card', { hasText: 'Note Alpha' });
    await expect(note).toBeVisible();

    // 2. Select note alone: SelectionToolbar shows 1 PART
    await note.click();
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toBeVisible();
    await expect(page.getByTestId('selection-count')).toHaveText('1 PART');

    // 3. Shift-click a node to create a mixed selection (1 note + 1 node): toolbar shows 2 PARTS
    const node = page.locator('.component-node').first();
    await node.click({ modifiers: ['Shift'] });
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    // 4. Align mixed selection (top alignment)
    await page.getByTestId('selection-align-btn').click();
    await page.getByTestId('selection-align-top').click();
    await waitForIdle(page);

    const noteBox = await note.boundingBox();
    const nodeBox = await node.boundingBox();
    expect(noteBox).not.toBeNull();
    expect(nodeBox).not.toBeNull();
    expect(Math.abs(noteBox!.y - nodeBox!.y)).toBeLessThan(1);

    // 5. Group node + note: select remaining note and node, then group them
    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Mixed Note Group');
    await groupInput.press('Enter');
    await waitForIdle(page);

    const boundary = page.locator('.group-boundary', { hasText: 'Mixed Note Group' });
    await expect(boundary).toBeVisible();

    // Clear selection then click group container header: selects group elements + attached notes
    await page.locator('.react-flow__pane').click({ position: { x: 50, y: 50 } });
    await waitForIdle(page);
    await boundary.locator('span', { hasText: 'Mixed Note Group' }).click();
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');
    await expect(page.getByTestId('selection-ungroup-btn')).toBeVisible();

    // 6. Ungroup
    await page.getByTestId('selection-ungroup-btn').click();
    await waitForIdle(page);
    await expect(boundary).toHaveCount(0);

    // 7. Duplicate mixed selection: duplicates both the note and the node
    await note.click();
    await node.click({ modifiers: ['Shift'] });
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    // A duplicate rests as a bubble (possibly under another note), so count both forms.
    const noteCount = () => page.locator('.note-card, [data-testid^="note-bubble-"]');
    const initialNoteCount = await noteCount().count();
    await page.getByTestId('selection-duplicate-btn').click();
    const confirmBtn = page.getByTestId('duplicate-confirm-btn');
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
    }
    await waitForIdle(page);
    await expect(noteCount()).toHaveCount(initialNoteCount + 1);

    // 8. Delete a note: click the duplicated note and press Delete
    const notes = page.locator('.note-card');
    await notes.last().click({ force: true });
    await waitForIdle(page);
    await expect(page.getByTestId('selection-count')).toHaveText('1 PART');
    await page.keyboard.press('Delete');
    await waitForIdle(page);
    await expect(noteCount()).toHaveCount(initialNoteCount);
  });

  test('selection box and grouping box have identical uniform spacing and matching position', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s01').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');
    const nodeA = nodes.nth(0);
    const nodeB = nodes.nth(1);

    // 1. Select two nodes: selection box appears with uniform 24px spacing
    await nodeA.click();
    await nodeB.click({ modifiers: ['Shift'] });
    await waitForIdle(page);

    const selectionRect = page.getByTestId('canvas-selection-box');
    await expect(selectionRect).toBeVisible();

    const selBox = await selectionRect.boundingBox();
    expect(selBox).not.toBeNull();

    // 2. Group the selection
    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Uniform Test Group');
    await groupInput.press('Enter');
    await waitForIdle(page);

    // 3. Selection box is removed!
    await expect(selectionRect).toHaveCount(0);

    // 4. Grouping box is visible in the same position and dimensions
    const groupBox = page.locator('.group-boundary', { hasText: 'Uniform Test Group' });
    await expect(groupBox).toBeVisible();

    const grpBox = await groupBox.boundingBox();
    expect(grpBox).not.toBeNull();

    // Grouping box bounds match selection box bounds (within 2px tolerance for subpixel borders)
    expect(Math.abs(grpBox!.x - selBox!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(grpBox!.y - selBox!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(grpBox!.width - selBox!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(grpBox!.height - selBox!.height)).toBeLessThanOrEqual(2);
  });
});

