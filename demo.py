from syncpad import Replica


def main() -> None:
    seed = Replica("seed")
    operations = (seed.insert(0, "A"), seed.insert(1, "B"))
    alice, bob = Replica("alice"), Replica("bob")
    for replica in (alice, bob):
        for operation in operations:
            replica.receive(operation)
    x, y = alice.insert(1, "x"), bob.insert(1, "y")
    print(f"Alice local: {alice.text()}")
    print(f"Bob local: {bob.text()}")
    alice.receive(y)
    alice.receive(y)
    bob.receive(x)
    bob.receive(x)
    print(f"Alice after x,y,y: {alice.text()}")
    print(f"Bob after y,x,x: {bob.text()}")
    assert alice.text() == bob.text()
    print(f"Final agreement: {alice.text()}")


if __name__ == "__main__":
    main()
