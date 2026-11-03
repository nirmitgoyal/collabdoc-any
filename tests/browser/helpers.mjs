import { expect } from '@playwright/test';

export async function openEditor(browser) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.wire = { sockets: [], held: [], hold: false, snapshots: [], updates: [] };
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        window.wire.sockets.push(this);
        this.addEventListener('message', event => {
          const message = JSON.parse(event.data);
          if (message.type === 'snapshot') window.wire.snapshots.push(message);
          if (message.type === 'update') window.wire.updates.push(message);
        });
      }
      send(data) {
        if (window.wire.hold) window.wire.held.push([this, data]);
        else super.send(data);
      }
    };
    window.wire.release = (duplicate = false) => {
      window.wire.hold = false;
      for (const [socket, data] of window.wire.held.splice(0)) {
        NativeSocket.prototype.send.call(socket, data);
        if (duplicate) NativeSocket.prototype.send.call(socket, data);
      }
    };
  });
  const page = await context.newPage();
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Document', exact: true });
  await expect(editor).toBeEditable();
  return { context, page, editor };
}
export async function select(page, start, end = start, direction = 'none') {
  await page.getByRole('textbox').evaluate((element, args) => {
    element.focus();
    element.setSelectionRange(...args);
  }, [start, end, direction]);
}
export async function clearDocument(client) {
  await client.editor.fill('');
  await expect.poll(() => client.page.evaluate(() => window.wire.updates.at(-1)?.visible.map(x => x[1]).join(''))).toBe('');
}
