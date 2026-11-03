import { test, expect } from '@playwright/test';
import { openEditor, select, clearDocument } from './helpers.mjs';

test('plain text, multiline Unicode and refresh retain acknowledged content', async ({ browser }) => {
  const a = await openEditor(browser);
  const b = await openEditor(browser);
  try {
    await clearDocument(a);
    await a.editor.fill('<b>Hello</b>\n😀 café');
    await expect(b.editor).toHaveValue('<b>Hello</b>\n😀 café');
    await a.page.reload();
    await expect(a.editor).toBeEditable();
    await expect(a.editor).toHaveValue('<b>Hello</b>\n😀 café');
    await expect(a.page.locator('b')).toHaveCount(0);
    await a.page.setViewportSize({ width: 320, height: 640 });
    expect(await a.editor.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(320);
  } finally { await a.context.close(); await b.context.close(); }
});

test('remote edits preserve focus and backward selection at the intended passage', async ({ browser }) => {
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('hello world'); await expect(b.editor).toHaveValue('hello world');
    await select(b.page, 6, 11, 'backward');
    await select(a.page, 0); await a.page.keyboard.insertText('!');
    await expect(b.editor).toHaveValue('!hello world');
    await expect(b.editor).toBeFocused();
    expect(await b.editor.evaluate(el => [el.selectionStart, el.selectionEnd, el.selectionDirection])).toEqual([7, 12, 'backward']);
    await b.page.keyboard.insertText('earth');
    await expect(a.editor).toHaveValue('!hello earth');
  } finally { await a.context.close(); await b.context.close(); }
});

test('repeated letters and emoji replace the selected IDs during a collision', async ({ browser }) => {
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('aa😀B'); await expect(b.editor).toHaveValue('aa😀B');
    await b.page.evaluate(() => window.wire.hold = true);
    await select(b.page, 1, 2); await b.page.keyboard.insertText('x');
    await select(a.page, 0, 1); await a.page.keyboard.insertText('y');
    await expect(b.editor).toHaveValue('yx😀B');
    await b.page.evaluate(() => window.wire.release());
    await expect(a.editor).toHaveValue('yx😀B');
    await select(b.page, 2, 4); await b.page.keyboard.insertText('🦊');
    await expect(a.editor).toHaveValue('yx🦊B');
  } finally { await a.context.close(); await b.context.close(); }
});

test('composition keeps its draft through a remote update and commits once', async ({ browser }) => {
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('AB'); await expect(b.editor).toHaveValue('AB');
    await select(b.page, 1);
    await b.editor.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.setRangeText('に', 1, 1, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: 'に' }));
    });
    await select(a.page, 0); await a.page.keyboard.insertText('!');
    await expect.poll(() => b.page.evaluate(() => window.wire.updates.at(-1)?.visible.map(x => x[1]).join(''))).toBe('!AB');
    await expect(b.editor).toHaveValue('AにB');
    await b.editor.evaluate(el => {
      el.setRangeText('日本', 1, 2, 'end');
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '日本' }));
    });
    await expect(a.editor).toHaveValue('!A日本B');
    await expect(b.editor).toHaveValue('!A日本B');
    expect(await b.page.evaluate(() => window.wire.updates.filter(m => m.ops.some(op => op.character === '日')).length)).toBe(1);
  } finally { await a.context.close(); await b.context.close(); }
});

test('disconnect preserves pending text for copying and reload restores accepted state', async ({ browser }) => {
  const a = await openEditor(browser);
  try {
    await a.editor.fill('saved');
    await expect.poll(() => a.page.evaluate(() => window.wire.updates.at(-1)?.visible.map(x => x[1]).join(''))).toBe('saved');
    await a.page.evaluate(() => window.wire.hold = true);
    await a.page.keyboard.insertText(' draft');
    await expect(a.editor).toHaveValue('saved draft');
    await a.page.evaluate(() => window.wire.sockets[0].close());
    await expect(a.editor).not.toBeEditable();
    await expect(a.page.getByRole('alert')).toContainText('copy');
    await select(a.page, 0, 11);
    expect(await a.editor.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('saved draft');
    await a.page.keyboard.insertText('discard');
    await expect(a.editor).toHaveValue('saved draft');
    await a.page.reload(); await expect(a.editor).toBeEditable();
    await expect(a.editor).toHaveValue('saved');
  } finally { await a.context.close(); }
});

test('native IME events commit once while a remote update is pending', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP drives native composition in Chromium only');
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('AB'); await expect(b.editor).toHaveValue('AB');
    await select(b.page, 1);
    const session = await b.context.newCDPSession(b.page);
    await session.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await expect(b.editor).toHaveValue('AにB');
    await select(a.page, 0); await a.page.keyboard.insertText('!');
    await expect.poll(() => b.page.evaluate(() => window.wire.updates.at(-1)?.visible.map(x => x[1]).join(''))).toBe('!AB');
    await expect(b.editor).toHaveValue('AにB');
    await session.send('Input.insertText', { text: '日本' });
    await expect(a.editor).toHaveValue('!A日本B');
    await expect(b.editor).toHaveValue('!A日本B');
    expect(await b.page.evaluate(() => window.wire.updates.filter(m => m.ops.some(op => op.character === '日')).length)).toBe(1);
  } finally { await a.context.close(); await b.context.close(); }
});

test('Backspace in repeated text deletes the character before the caret during a collision', async ({ browser }) => {
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('aaa'); await expect(b.editor).toHaveValue('aaa');
    await b.page.evaluate(() => window.wire.hold = true);
    await select(b.page, 2); await b.page.keyboard.press('Backspace');
    await expect(b.editor).toHaveValue('aa');
    await select(a.page, 2, 3); await a.page.keyboard.insertText('X');
    await b.page.evaluate(() => window.wire.release());
    await expect(a.editor).toHaveValue('aX'); await expect(b.editor).toHaveValue('aX');
  } finally { await a.context.close(); await b.context.close(); }
});
