"""Atomic wire validation around the single-document merge core."""

from syncpad import Delete, Insert, OpId, Replica


def _id(value):
    if (not isinstance(value, list) or len(value) != 2
            or type(value[0]) is not int or not 0 < value[0] < 2**53
            or not isinstance(value[1], str) or not value[1] or not value[1].isascii()):
        raise ValueError('Invalid operation ID')
    return OpId(*value)


def _wire_id(value):
    return [value.counter, value.actor]


class Document:
    def __init__(self):
        self._replica = Replica('server')
        self._operations = {}
        self._revision = 0
        self._clock = 0

    def _visible(self):
        return [[_wire_id(id), self._operations[id].character]
                for id in self._replica.visible_ids()]

    def _wire(self, operation):
        if isinstance(operation, Insert):
            return {'kind': 'insert', 'id': _wire_id(operation.id),
                    'predecessor': (_wire_id(operation.predecessor)
                                    if operation.predecessor else None),
                    'character': operation.character}
        return {'kind': 'delete', 'id': _wire_id(operation.id),
                'target': _wire_id(operation.target)}

    def snapshot(self, actor):
        return {'type': 'snapshot', 'actor': actor, 'revision': self._revision,
                'clock': self._clock,
                'ops': [self._wire(op) for op in self._operations.values()],
                'visible': self._visible()}

    def apply(self, actor, ops):
        if not isinstance(ops, list):
            raise ValueError('Expected operation list')
        staged = {}
        acknowledgements = []
        for record in ops:
            if not isinstance(record, dict):
                raise ValueError('Expected operation record')
            id = _id(record.get('id'))
            if id.actor != actor:
                raise ValueError('Operation belongs to a different writer')
            kind = record.get('kind')
            if kind == 'insert' and set(record) == {'kind', 'id', 'predecessor', 'character'}:
                character = record['character']
                if (not isinstance(character, str) or len(character) != 1
                        or 0xD800 <= ord(character) <= 0xDFFF):
                    raise ValueError('Expected one Unicode scalar')
                reference = _id(record['predecessor']) if record['predecessor'] is not None else None
                operation = Insert(id, reference, character)
            elif kind == 'delete' and set(record) == {'kind', 'id', 'target'}:
                reference = _id(record['target'])
                operation = Delete(id, reference)
            else:
                raise ValueError('Invalid operation record')
            previous = staged.get(id, self._operations.get(id))
            if previous is not None:
                if previous != operation:
                    raise ValueError('Operation ID reused with different content')
            else:
                if reference is not None:
                    anchor = staged.get(reference, self._operations.get(reference))
                    if not isinstance(anchor, Insert) or reference.counter >= id.counter:
                        raise ValueError('Invalid insertion reference')
                staged[id] = operation
            acknowledgements.append(_wire_id(id))
        for operation in staged.values():
            self._replica.receive(operation)
            self._operations[operation.id] = operation
            self._clock = max(self._clock, operation.id.counter)
        if staged:
            self._revision += 1
        return {'type': 'update', 'revision': self._revision,
                'ops': [self._wire(op) for op in staged.values()],
                'visible': self._visible(), 'ack': acknowledgements}
