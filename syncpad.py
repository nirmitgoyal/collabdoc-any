from dataclasses import dataclass


@dataclass(frozen=True)
class OpId:
    counter: int
    actor: str


@dataclass(frozen=True)
class Insert:
    id: OpId
    predecessor: OpId | None
    character: str


@dataclass(frozen=True)
class Delete:
    id: OpId
    target: OpId


Operation = Insert | Delete


class Replica:
    def __init__(self, actor: str):
        if not actor.isascii():
            raise ValueError("Actor ID must be ASCII")
        self._actor = actor
        self._counter = 0
        self._insertions: dict[OpId, Insert] = {}
        self._deleted: set[OpId] = set()

    def receive(self, operation: Operation) -> None:
        self._counter = max(self._counter, operation.id.counter)
        if isinstance(operation, Insert):
            self._insertions[operation.id] = operation
        else:
            self._deleted.add(operation.target)

    def _visible_ids(self) -> list[OpId]:
        children: dict[OpId | None, list[OpId]] = {}
        for operation in self._insertions.values():
            children.setdefault(operation.predecessor, []).append(operation.id)
        for siblings in children.values():
            siblings.sort(key=lambda id: (-id.counter, id.actor))
        stack = list(reversed(children.get(None, [])))
        visible = []
        while stack:
            id = stack.pop()
            if id not in self._deleted:
                visible.append(id)
            stack.extend(reversed(children.get(id, [])))
        return visible

    def visible_ids(self) -> list[OpId]:
        return self._visible_ids()

    def text(self) -> str:
        return "".join(self._insertions[id].character for id in self._visible_ids())

    def insert(self, index: int, character: str) -> Insert:
        visible = self._visible_ids()
        if not 0 <= index <= len(visible):
            raise IndexError("Insert index out of range")
        if (not isinstance(character, str) or len(character) != 1
                or 0xD800 <= ord(character) <= 0xDFFF):
            raise ValueError("Insert requires one Unicode scalar")
        predecessor = visible[index - 1] if index else None
        operation = Insert(OpId(self._counter + 1, self._actor), predecessor, character)
        self.receive(operation)
        return operation

    def delete(self, index: int) -> Delete:
        visible = self._visible_ids()
        if not 0 <= index < len(visible):
            raise IndexError("Delete index out of range")
        operation = Delete(OpId(self._counter + 1, self._actor), visible[index])
        self.receive(operation)
        return operation
