# Syncpad character-level editor

Design for review · 3 November 2026

## Outcome

Two independent in-memory replicas can edit the same plain-text document before hearing from each other. Once both receive the same set of valid edits, they render identical text and can continue editing from it. Both concurrent insertions survive unless an edit explicitly deletes one of them. A teammate can run a two-user demonstration and the tests locally using commands documented in the README.

## Approaches considered

The selected approach gives each inserted character a stable identity. Two users can insert into the same gap and see both contributions. This requires retaining deleted anchors and resolving edits received before their dependencies. The alternative was a list of editable blocks with one deterministic winner for concurrent replacements of the same block. It was simpler, but could discard an entire paragraph revision.

## Replica contract

Each replica starts empty with the same invisible root. To share initial text, replay the same seed operations on each replica so that character identities match. Each replica has a distinct immutable ASCII actor ID. Assume a single writer per actor and serialized calls within a replica. Concurrency comes from replicas generating edits independently.

| Operation | Behavior |
|---|---|
| insert(index, character) | Insert one Unicode scalar at a zero-based gap in the visible text, including the end. Record the ID of the visible predecessor, or root at index zero. Apply locally and return the operation for delivery. |
| delete(index) | Record the stable ID of the visible character at that index. Apply locally and return the delete operation. |
| receive(operation) | Merge an immutable operation into the replica. Delivery may be delayed, reordered or repeated. |
| text() | Return visible characters in deterministic traversal order. |

Indexes count Unicode scalars. Reject invalid indexes and invalid local character input without changing state. Multi-scalar graphemes occupy multiple positions. Remote input is trusted, well-formed output from these APIs for this document. Eventual delivery of all dependencies is assumed for the final result.

## Merge rules

1. Each operation has an ID pairing a logical counter with its actor ID. The counter starts at zero. On receipt, raise the local counter to the maximum of its current value and the received counter, even for an unresolved operation. For a local edit increment the counter first. Identical IDs always denote identical operations under the single-writer assumption.
2. Store insertions by ID, retaining their predecessor IDs. Store deletions as a set of target insertion IDs. Replaying either operation has no additional effect. An insertion with a missing predecessor remains stored but unreachable. A deletion received before its insertion already marks that target as hidden.
3. Render from root using depth-first preorder. Visit siblings by descending counter, then ascending actor ID in ASCII order. Emit each character unless its ID is deleted. Always visit its descendants. New local insertions have higher counters than every observed sibling, which places the new character in the gap the user selected.
4. The insertion map and deletion set depend only on the operations received. Given these collections, traversal has one result. No decision uses wall-clock time, arrival order or a mutable remote index. For this exercise a full traversal per read or index lookup is acceptable. Deleted anchors are retained for the document lifetime.

## Acceptance examples

Seed operations create A then B in order. Alice and Bob both receive the seed before editing and use actor IDs alice and bob. Each row starts fresh.

| Scenario | Required observation |
|---|---|
| Same gap | Alice inserts x and Bob inserts y at index 1. Local views are AxB and AyB. After exchanging edits both read AxyB. A third replica replaying the same operations in reverse order also reads AxyB. |
| Retry | Redeliver either insert multiple times. Text stays AxyB. |
| Deleted anchor | Alice deletes A while Bob inserts y after A. Both read yB after exchange. |
| Delete before insert | Alice inserts x, then deletes x. Deliver the delete first to Bob. Bob never renders x and both finish at AB. |
| Missing predecessor | Alice inserts x after A then z after x. Deliver z first. Bob reads AB until x arrives, then AxzB. |
| Convergence across schedules | Starting from the shared seed, permute delivery of Alice's x then z and Bob's concurrent y to fresh replicas. All six permutations produce AxzyB. |
| Boundaries | Verify prepend, append, delete-last and empty text. Insert an emoji and delete it by its single scalar position. Invalid indexes leave text unchanged. |

## Completion criteria

The core is complete when automated tests pass for every acceptance example above. Safe replay is the first production-readiness priority because a retried insert must never create a second character. The runnable demo prints both local views, exchanges edits in different orders, repeats a delivery and shows the final agreement.

Language, test runner and internal collections are builder choices. Implement reconciliation directly. UI, real transport, persistence, restart-safe actor identity, tombstone collection, deployment, Docker and CI are outside this exercise. The README should explain the merge rule, how to run the demo and tests, and the memory cost of retaining editing history.
