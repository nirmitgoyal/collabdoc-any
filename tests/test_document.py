import unittest

from document import Document


def insert(counter, actor, predecessor, character):
    return {'kind': 'insert', 'id': [counter, actor], 'predecessor': predecessor,
            'character': character}


def text(message):
    return ''.join(character for _, character in message['visible'])


class DocumentTests(unittest.TestCase):
    def seed(self):
        document = Document()
        document.apply('seed', [insert(1, 'seed', None, 'A'),
                                insert(2, 'seed', [1, 'seed'], 'B')])
        return document

    def test_snapshot_collision_and_retry(self):
        self.assertEqual(Document().snapshot('alice'), {
            'type': 'snapshot', 'actor': 'alice', 'revision': 0, 'clock': 0,
            'ops': [], 'visible': []})
        for actors in [('alice', 'bob'), ('bob', 'alice')]:
            with self.subTest(actors=actors):
                document = self.seed()
                self.assertEqual(document.snapshot('new')['revision'], 1)
                for actor in actors:
                    result = document.apply(actor, [insert(3, actor, [1, 'seed'],
                                                          'x' if actor == 'alice' else 'y')])
                self.assertEqual(text(result), 'AxyB')
                duplicate = document.apply('alice', [insert(3, 'alice', [1, 'seed'], 'x')])
                self.assertEqual(duplicate['revision'], 3)
                self.assertEqual(duplicate['ops'], [])
                self.assertEqual(duplicate['ack'], [[3, 'alice']])
                self.assertEqual(document.snapshot('late')['clock'], 3)

    def test_invalid_batch_is_atomic(self):
        document = self.seed()
        invalids = [insert(4, 'alice', [3, 'alice'], '\ud800'),
                    insert(3, 'alice', [1, 'seed'], 'z'),
                    insert(4, 'bob', None, 'z'),
                    insert(True, 'alice', None, 'z'),
                    insert(2**53, 'alice', None, 'z'),
                    insert(4, 'alice', [9, 'missing'], 'z'),
                    {'kind': 'delete', 'id': [4, 'alice'], 'target': [9, 'missing']}]
        for invalid in invalids:
            before = document.snapshot('reader')
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                document.apply('alice', [insert(3, 'alice', [1, 'seed'], 'x'), invalid])
            self.assertEqual(document.snapshot('reader'), before)

    def test_deleted_anchor_remains_a_valid_reference(self):
        document = self.seed()
        document.apply('alice', [{'kind': 'delete', 'id': [3, 'alice'], 'target': [1, 'seed']}])
        update = document.apply('bob', [insert(3, 'bob', [1, 'seed'], 'y')])
        self.assertEqual(text(update), 'yB')
        self.assertEqual(len(document.snapshot('late')['ops']), 4)

    def test_malformed_records_and_cycles_are_rejected(self):
        document = Document()
        for ops in [None, {}, [None], [{'kind': 'other', 'id': [1, 'alice']}],
                    [insert(1, 'alice', [1, 'alice'], 'x')],
                    [insert(1, 'alice', None, 'xx')],
                    [insert(1, 'alice', None, 'x') | {'extra': True}]]:
            with self.subTest(ops=ops), self.assertRaises(ValueError):
                document.apply('alice', ops)
            self.assertEqual(document.snapshot('reader')['revision'], 0)
