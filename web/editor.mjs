import { BrowserReplica } from './replica.mjs';

const editor = document.querySelector('textarea');
const alert = document.querySelector('[role="alert"]');
const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
let replica;
let displayed = [];
let before;
let composition;
let finishing;
let stopped = false;
const key = id => JSON.stringify(id);

function scalarOffset(text, offset) {
  let units = 0;
  let scalars = 0;
  for (const character of text) {
    if (units + character.length > offset) break;
    units += character.length;
    scalars++;
  }
  return scalars;
}

function gap(view, offset) {
  return { left: view[offset - 1]?.[0] ?? null, right: view[offset]?.[0] ?? null };
}

function selection(view = displayed) {
  return {
    start: gap(view, scalarOffset(editor.value, editor.selectionStart)),
    end: gap(view, scalarOffset(editor.value, editor.selectionEnd)),
    direction: editor.selectionDirection,
  };
}

function resolve(boundary, view) {
  const ordered = replica.orderedIds().map(key);
  const visible = new Set(view.map(([id]) => key(id)));
  const anchor = boundary.right ?? boundary.left;
  if (anchor === null) return 0;
  const index = ordered.indexOf(key(anchor));
  const limit = index + (boundary.right === null ? 1 : 0);
  return ordered.slice(0, limit).filter(id => visible.has(id)).length;
}

function render(saved = selection()) {
  displayed = replica.view();
  const text = displayed.map(([, character]) => character);
  const start = text.slice(0, resolve(saved.start, displayed)).join('').length;
  const end = text.slice(0, resolve(saved.end, displayed)).join('').length;
  const scrollTop = editor.scrollTop;
  const scrollLeft = editor.scrollLeft;
  const value = text.join('');
  if (editor.value !== value) editor.value = value;
  editor.setSelectionRange(start, end, saved.direction);
  editor.scrollTop = scrollTop;
  editor.scrollLeft = scrollLeft;
}

function capture() {
  return {
    view: displayed,
    start: scalarOffset(editor.value, editor.selectionStart),
    end: scalarOffset(editor.value, editor.selectionEnd),
  };
}

function commit(original) {
  if (stopped) return;
  const old = original.view.map(([, character]) => character);
  const current = [...editor.value];
  // Bound the diff by the original selection: equal neighboring letters must
  // not shift an edit to a different character's ID.
  let limit = original.start;
  if (original.start === original.end && original.inputType?.endsWith('Backward')) {
    limit = Math.max(0, limit - (old.length - current.length));
  }
  let start = 0;
  while (start < limit && start < current.length && old[start] === current[start]) start++;
  let suffix = 0;
  while (suffix < old.length - original.end && suffix < current.length - start
      && old[old.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;
  const end = old.length - suffix;
  const replacement = current.slice(start, current.length - suffix).join('');
  const ops = replica.replaceIds(original.view.slice(start, end).map(([id]) => id),
    original.view[start - 1]?.[0] ?? null, replacement);
  const localView = [...original.view.slice(0, start),
    ...ops.filter(op => op.kind === 'insert').map(op => [op.id, op.character]),
    ...original.view.slice(end)];
  const saved = selection(localView);
  render(saved);
  if (ops.length) {
    try { socket.send(JSON.stringify({ type: 'edit', ops })); }
    catch { disconnected(); }
  }
}

function disconnected() {
  stopped = true;
  clearTimeout(finishing);
  editor.readOnly = true;
  alert.textContent = 'Connection lost. You can copy your text before reloading to reconnect.';
  alert.hidden = false;
}

editor.addEventListener('beforeinput', event => {
  if (replica && !composition && !stopped) before = { ...capture(), inputType: event.inputType };
});
editor.addEventListener('input', event => {
  if (!replica || stopped || composition || event.isComposing) return;
  commit(before ?? { view: displayed, start: 0, end: displayed.length });
  before = undefined;
});
editor.addEventListener('compositionstart', () => {
  if (!stopped && replica) { composition = capture(); before = undefined; }
});
editor.addEventListener('compositionend', () => {
  // Some browsers emit the final input after compositionend. Keep the native
  // buffer untouched until both events have completed, then commit once.
  if (!composition || stopped) return;
  finishing = setTimeout(() => {
    const original = composition;
    composition = undefined;
    commit(original);
  }, 0);
});
socket.addEventListener('message', event => {
  if (stopped) return;
  try {
    const message = JSON.parse(event.data);
    if (message.type === 'snapshot') {
      replica = new BrowserReplica(message);
      render();
      editor.readOnly = false;
    } else if (message.type === 'update' && replica) {
      const saved = selection();
      replica.receive(message);
      if (!composition) render(saved);
    } else throw new Error('Unexpected server message');
  } catch {
    disconnected();
    socket.close();
  }
});
socket.addEventListener('close', disconnected);
socket.addEventListener('error', disconnected);
