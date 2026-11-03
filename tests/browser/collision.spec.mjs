import { test, expect } from '@playwright/test';
import { openEditor, select } from './helpers.mjs';

for (const reverse of [false, true]) {
  test(`same-gap collision survives ${reverse ? 'reversed' : 'forward'} delivery and retries`, async ({ browser }) => {
    const a = await openEditor(browser); const b = await openEditor(browser);
    try {
      await a.editor.fill('AB'); await expect(b.editor).toHaveValue('AB');
      for (const client of [a, b]) {
        await client.page.evaluate(() => window.wire.hold = true);
        await select(client.page, 1);
      }
      await a.page.keyboard.insertText('x'); await b.page.keyboard.insertText('y');
      await expect(a.editor).toHaveValue('AxB'); await expect(b.editor).toHaveValue('AyB');
      const actorA = await a.page.evaluate(() => window.wire.snapshots[0].actor);
      const actorB = await b.page.evaluate(() => window.wire.snapshots[0].actor);
      for (const client of reverse ? [b, a] : [a, b]) {
        await client.page.evaluate(() => window.wire.release(true));
      }
      const expected = actorA < actorB ? 'AxyB' : 'AyxB';
      await expect(a.editor).toHaveValue(expected); await expect(b.editor).toHaveValue(expected);
    } finally { await a.context.close(); await b.context.close(); }
  });
}

test('deleting an anchor concurrently preserves the insertion below it', async ({ browser }) => {
  const a = await openEditor(browser); const b = await openEditor(browser);
  try {
    await a.editor.fill('AB'); await expect(b.editor).toHaveValue('AB');
    for (const client of [a, b]) await client.page.evaluate(() => window.wire.hold = true);
    await select(a.page, 0, 1); await a.page.keyboard.press('Backspace');
    await select(b.page, 1); await b.page.keyboard.insertText('y');
    await expect(a.editor).toHaveValue('B'); await expect(b.editor).toHaveValue('AyB');
    await a.page.evaluate(() => window.wire.release()); await b.page.evaluate(() => window.wire.release());
    await expect(a.editor).toHaveValue('yB'); await expect(b.editor).toHaveValue('yB');
  } finally { await a.context.close(); await b.context.close(); }
});
