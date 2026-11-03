import unittest
from itertools import permutations

from syncpad import Delete, Insert, OpId, Replica


class MergeTests(unittest.TestCase):
    def test_reordered_history(self):
        r = Replica("reader")
        a = Insert(OpId(1, "seed"), None, "A")
        b = Insert(OpId(2, "seed"), a.id, "B")
        x = Insert(OpId(3, "alice"), a.id, "x")
        y = Insert(OpId(3, "bob"), a.id, "y")
        hide_a = Delete(OpId(4, "alice"), a.id)
        for op, expected in [(y, ""), (b, ""), (x, ""), (a, "AxyB"),
                             (hide_a, "xyB"), (x, "xyB"), (hide_a, "xyB")]:
            r.receive(op)
            self.assertEqual(r.text(), expected)


class LocalTests(unittest.TestCase):
    def test_scalar_positions(self):
        r = Replica("alice")
        r.insert(0, "e")
        r.insert(1, "\u0301")
        r.insert(0, "😀")
        self.assertEqual(r.text(), "😀e\u0301")
        for index, expected in [(0, "e\u0301"), (1, "e"), (0, "")]:
            r.delete(index)
            self.assertEqual(r.text(), expected)

    def test_validation_and_clock(self):
        r = Replica("alice")
        r.receive(Insert(OpId(12, "bob"), OpId(11, "bob"), "z"))
        for index in (-1, 1):
            with self.assertRaises(IndexError):
                r.insert(index, "x")
        for index in (-1, 0):
            with self.assertRaises(IndexError):
                r.delete(index)
        for character in ("", "ab", "e\u0301", "\ud800"):
            with self.assertRaises(ValueError):
                r.insert(0, character)
        self.assertEqual(r.text(), "")
        x = r.insert(0, "x")
        self.assertEqual(x, Insert(OpId(13, "alice"), None, "x"))
        self.assertEqual(r.delete(0), Delete(OpId(14, "alice"), x.id))


def seeded_pair():
    seed = Replica("seed")
    operations = (seed.insert(0, "A"), seed.insert(1, "B"))
    alice, bob = Replica("alice"), Replica("bob")
    for r in (alice, bob):
        for operation in operations:
            r.receive(operation)
    return alice, bob, operations


class ScheduleTests(unittest.TestCase):
    def test_same_gap_and_retry(self):
        alice, bob, seed = seeded_pair()
        x, y = alice.insert(1, "x"), bob.insert(1, "y")
        self.assertEqual((alice.text(), bob.text()), ("AxB", "AyB"))
        for r in (alice, bob):
            for operation in (x, y, x, y):
                r.receive(operation)
            self.assertEqual(r.text(), "AxyB")
        reader = Replica("reader")
        for operation in reversed([*seed, x, y]):
            reader.receive(operation)
        self.assertEqual(reader.text(), "AxyB")

    def test_deleted_anchor(self):
        alice, bob, _ = seeded_pair()
        deletion, insertion = alice.delete(0), bob.insert(1, "y")
        alice.receive(insertion)
        bob.receive(deletion)
        self.assertEqual((alice.text(), bob.text()), ("yB", "yB"))

    def test_delete_before_insert(self):
        alice, bob, _ = seeded_pair()
        insertion = alice.insert(1, "x")
        deletion = alice.delete(1)
        for operation in (deletion, insertion):
            bob.receive(operation)
            self.assertEqual(bob.text(), "AB")
        self.assertEqual(alice.text(), "AB")

    def test_missing_predecessor(self):
        alice, bob, _ = seeded_pair()
        x, z = alice.insert(1, "x"), alice.insert(2, "z")
        bob.receive(z)
        self.assertEqual(bob.text(), "AB")
        bob.receive(x)
        self.assertEqual(bob.text(), "AxzB")

    def test_six_schedules_and_followup(self):
        alice, bob, seed = seeded_pair()
        x, z = alice.insert(1, "x"), alice.insert(2, "z")
        y = bob.insert(1, "y")
        readers = []
        for index, schedule in enumerate(permutations((x, z, y))):
            reader = Replica(f"reader{index}")
            for operation in (*seed, *schedule):
                reader.receive(operation)
            self.assertEqual(reader.text(), "AxzyB")
            readers.append(reader)
        deletion = readers[0].delete(2)
        for reader in readers:
            reader.receive(deletion)
            self.assertEqual(reader.text(), "AxyB")


if __name__ == "__main__":
    unittest.main()
