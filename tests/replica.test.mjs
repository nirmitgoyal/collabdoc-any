import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserReplica } from '../web/replica.mjs';

const insert = (counter, actor, predecessor, character) => ({ kind: 'insert', id: [counter, actor], predecessor, character });
const remove = (counter, actor, target) => ({ kind: 'delete', id: [counter, actor], target });
const A = insert(1, 'seed', null, 'A');
const B = insert(2, 'seed', A.id, 'B');
const snapshot = (actor = 'alice', ops = [A, B], clock = 2) => ({ type: 'snapshot', actor, revision: 1, clock, ops });
const update = (revision, ops, ack = []) => ({ type: 'update', revision, ops, ack });
const text = replica => replica.view().map(([, character]) => character).join('');

test('replacement applies immediately and allocates scalar IDs above snapshot clock', () => {
  const replica = new BrowserReplica(snapshot('alice', [A, B], 8));
  const ops = replica.replace(1, 2, '😀\n');
  assert.deepEqual(ops, [remove(9, 'alice', B.id), insert(10, 'alice', A.id, '😀'), insert(11, 'alice', [10, 'alice'], '\n')]);
  assert.equal(text(replica), 'A😀\n');
});

test('pending insertion survives deleted anchor and repeated acknowledgements', () => {
  const replica = new BrowserReplica(snapshot());
  const [x] = replica.replace(1, 1, 'x');
  replica.receive(update(2, [remove(3, 'bob', A.id)]));
  assert.equal(text(replica), 'xB');
  replica.receive(update(3, [x], [x.id]));
  replica.receive(update(3, [x], [x.id]));
  assert.equal(text(replica), 'xB');
  assert.deepEqual(replica.orderedIds(), [A.id, x.id, B.id]);
});

test('same-gap inserts converge in both delivery orders using ASCII actor ordering', () => {
  const x = insert(3, 'alice', A.id, 'x');
  const y = insert(3, 'bob', A.id, 'y');
  for (const order of [[x, y], [y, x]]) {
    const replica = new BrowserReplica(snapshot());
    for (const op of order) replica.receive(update(2, [op]));
    assert.equal(text(replica), 'AxyB');
  }
  const replica = new BrowserReplica(snapshot());
  replica.receive(update(2, [insert(3, 'Z', A.id, 'z'), insert(3, 'a', A.id, 'a')]));
  assert.equal(text(replica), 'AzaB');
});

test('out-of-order insertions retain missing anchors and delete-before-insert targets', () => {
  const replica = new BrowserReplica(snapshot('alice', [], 0));
  replica.receive(update(3, [remove(3, 'bob', A.id), B]));
  assert.equal(text(replica), '');
  replica.receive(update(2, [A]));
  assert.equal(text(replica), 'B');
  assert.deepEqual(replica.replace(1, 1, 'x')[0].id, [4, 'alice']);
});

test('an old update cannot discard newer pending edits or roll back text', () => {
  const replica = new BrowserReplica(snapshot());
  const [x] = replica.replace(1, 1, 'x');
  replica.receive(update(2, [x], [x.id]));
  const [y] = replica.replace(2, 2, 'y');
  replica.receive(update(2, [x], [x.id]));
  assert.equal(text(replica), 'AxyB');
  replica.receive(update(3, [y], [y.id]));
  assert.equal(text(replica), 'AxyB');
});

test('composition replacement deletes original IDs while keeping intervening remote insertion', () => {
  const replica = new BrowserReplica(snapshot());
  replica.receive(update(2, [insert(3, 'bob', A.id, 'y')]));
  const ops = replica.replaceIds([B.id], A.id, '文');
  assert.deepEqual(ops, [remove(4, 'alice', B.id), insert(5, 'alice', A.id, '文')]);
  assert.equal(text(replica), 'A文y');
});

test('invalid scalar or range leaves text and clock unchanged', () => {
  const replica = new BrowserReplica(snapshot());
  for (const invalid of ['\ud800', '\udc00']) assert.throws(() => replica.replace(1, 1, invalid), /scalar/);
  for (const range of [[-1, 0], [0, 3], [2, 1], [0.5, 1]]) assert.throws(() => replica.replace(...range, 'x'), /range/);
  assert.equal(text(replica), 'AB');
  assert.deepEqual(replica.replace(1, 1, 'x')[0].id, [3, 'alice']);
});
