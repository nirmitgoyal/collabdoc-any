const key = id => JSON.stringify(id);
const copyId = id => id === null ? null : [...id];
const copyOperation = operation => operation.kind === 'insert'
  ? { ...operation, id: copyId(operation.id), predecessor: copyId(operation.predecessor) }
  : { ...operation, id: copyId(operation.id), target: copyId(operation.target) };

export class BrowserReplica {
  constructor(snapshot) {
    this.actor = snapshot.actor;
    this.clock = snapshot.clock;
    this.accepted = new Map();
    this.pending = new Map();
    this.receive(snapshot);
  }

  receive(update) {
    for (const operation of update.ops) {
      this.accepted.set(key(operation.id), copyOperation(operation));
      this.clock = Math.max(this.clock, operation.id[0]);
    }
    for (const id of update.ack ?? []) {
      const operation = this.pending.get(key(id));
      if (operation) this.accepted.set(key(id), operation);
      this.pending.delete(key(id));
    }
    if (this.pending.size === 0 && update.visible) {
      // A duplicate or delayed update may carry an obsolete projection.
      if ((this.revision ?? -1) <= update.revision
          && JSON.stringify(this.view()) !== JSON.stringify(update.visible)) {
        throw new Error('Server projection disagrees with operation history');
      }
    }
    this.revision = Math.max(this.revision ?? -1, update.revision);
  }

  traversal() {
    const operations = new Map([...this.accepted, ...this.pending]);
    const children = new Map();
    const deleted = new Set();
    for (const operation of operations.values()) {
      if (operation.kind === 'delete') {
        deleted.add(key(operation.target));
      } else {
        const predecessor = key(operation.predecessor);
        if (!children.has(predecessor)) children.set(predecessor, []);
        children.get(predecessor).push(operation);
      }
    }
    for (const siblings of children.values()) {
      siblings.sort((a, b) => b.id[0] - a.id[0]
        || (a.id[1] < b.id[1] ? -1 : a.id[1] > b.id[1] ? 1 : 0));
    }
    const stack = [...(children.get(key(null)) ?? [])].reverse();
    const result = [];
    while (stack.length) {
      const operation = stack.pop();
      result.push({ operation, deleted: deleted.has(key(operation.id)) });
      stack.push(...[...(children.get(key(operation.id)) ?? [])].reverse());
    }
    return result;
  }

  view() {
    return this.traversal().filter(entry => !entry.deleted)
      .map(({ operation }) => [copyId(operation.id), operation.character]);
  }

  orderedIds() {
    return this.traversal().map(({ operation }) => copyId(operation.id));
  }

  replace(start, end, text) {
    const visible = this.view();
    if (!Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end < start || end > visible.length) {
      throw new RangeError('Invalid replacement range');
    }
    return this.replaceIds(visible.slice(start, end).map(([id]) => id),
      start === 0 ? null : visible[start - 1][0], text);
  }

  replaceIds(targetIds, predecessor, text) {
    const characters = [...text];
    if (characters.some(character => {
      const scalar = character.codePointAt(0);
      return scalar >= 0xD800 && scalar <= 0xDFFF;
    })) throw new TypeError('Text requires Unicode scalars');
    if (!Number.isSafeInteger(this.clock + targetIds.length + characters.length)) {
      throw new RangeError('Operation counter exhausted');
    }
    const operations = [];
    for (const target of targetIds) {
      operations.push({ kind: 'delete', id: [++this.clock, this.actor], target: copyId(target) });
    }
    let anchor = copyId(predecessor);
    for (const character of characters) {
      const id = [++this.clock, this.actor];
      operations.push({ kind: 'insert', id, predecessor: anchor, character });
      anchor = id;
    }
    for (const operation of operations) this.pending.set(key(operation.id), copyOperation(operation));
    return operations;
  }
}
