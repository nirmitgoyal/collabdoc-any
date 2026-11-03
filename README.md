# syncpad

syncpad is a collaborative document editor you build from scratch. Picture something like Google Docs or Canva, where several people open the same document at once and all edit it at the same time. Each person's edits show up for everyone else, and the catch is that when two people change the same document concurrently, their edits can't clobber each other — everyone has to end up looking at the exact same document. Your job is the part underneath that: how the document is stored, how concurrent changes come in, and how they get reconciled so all the clients converge on one shared state.

## Your task

You have two jobs.

1. **Build the core and get it working.** A document model, a way to accept edit operations from multiple users at the same time, and the logic to reconcile those concurrent edits so every client deterministically lands on the same final document. The document itself can be whatever you want — plain text, a list of elements, a tree — so pick the simplest model that still lets two people's edits genuinely collide, and you don't need to build a UI or a real network around it. The reconciliation is the heart of this exercise, so build it yourself — reaching for an off-the-shelf collaboration engine like Yjs, Y-Sweet, Automerge, or ShareDB to do the merging defeats the point. Libraries for plumbing (a web framework, a websocket transport) are fine; the convergence logic is yours. What matters is that the clients end up in agreement — feed the same concurrent edits in different orders and every client lands on the identical final document. Resolving a clash by picking one edit over another is completely fine; what's not fine is two clients ending up in different states. Give yourself a way to feed in interleaved edits from two users and read back the converged document.
2. **Push it further toward production readiness.** The interesting part is where you go from the basics. You won't get it fully production-ready in the time you have, and we don't expect you to. Treat this like real code you'd be happy to hand a teammate, decide what would matter most for putting it in front of real users, and push it as far as you can on the things you pick. What "production ready" means here, and how far you grow the functionality beyond the core, is yours to define. Be ready to walk through your plan and defend why you tackled what you did first.
  One thing that's *not* in scope is deployment. We're not hosting this anywhere, so skip Dockerfiles, CI, and infra and focus on the code itself.

We care more about your judgment on what to tackle first than about a long list of half-finished features.

## Run locally

The core requires Python 3.10+ and no external dependencies. From the repository root:

```sh
python3 demo.py
python3 -m unittest discover -s tests -p test_syncpad.py -v
python3 -m unittest discover -s tests -p test_demo.py -v
```

The demo prints independent `AxB` and `AyB` views, exchanges the concurrent
inserts with duplicate deliveries, and finishes with `Final agreement: AxyB`.

## API and reconciliation

`Replica(actor)` starts empty. Use a distinct ASCII actor ID for each writer,
keep calls within each replica serialized, and seed replicas by delivering the
same seed operations. `insert(index, character)` and `delete(index)` apply
locally and return immutable operations; deliver these with `receive(operation)`.
`text()` returns the visible document. Indexes count Unicode scalars, so an emoji
occupies one position and a combining mark occupies its own position. Invalid
indexes or characters do not consume operation IDs or modify the document.

Every operation has a logical counter and actor ID. Receiving an operation
advances the local clock even if its predecessor has not arrived. Inserts name
stable predecessor IDs; deletes name stable target IDs. A depth-first preorder
from the invisible root orders siblings by descending counter, then ascending
ASCII actor ID. Deleted characters remain as anchors and their descendants
remain traversable. Missing predecessors keep inserts unreachable until their
history arrives; a delete arriving before its insert already hides that target.

The insertion map and deletion-target set depend only on the received operations.
Deterministic traversal therefore produces identical text after every replica
receives the same operation set, regardless of delivery order. Both concurrent
insertions survive. Safe retries are the first production-readiness priority:
inserts are keyed by ID and deletes are set additions, so redelivery has no
additional effect. Operations are trusted output from this API for one document;
actor IDs require a single writer and identical IDs must identify identical edits.

## Costs and limits

Memory is O(I + D), where I counts distinct insertions (including deleted anchors
and currently unreachable inserts) and D counts distinct deletion targets.
Each read or positional edit rebuilds and sorts the traversal in O(I log I)
worst-case time and O(I) temporary memory. Traversal uses an explicit stack so
long documents do not depend on Python's recursion limit. History is retained
for the document lifetime; there is no tombstone collection.

This is an in-memory core. Persistence, restart-safe actor identity, untrusted
wire validation and transport are outside the core API; the browser adapter below
validates wire batches. Deployment, Docker and CI remain outside scope.
Eventual delivery of dependencies is required for final convergence.


## Browser editor

Install the server dependency in an isolated environment, then launch locally:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

Open http://127.0.0.1:8000/ in Chrome and Firefox (or independent browser profiles).
The page contains one plain-text writing area. Type in either browser and edits
appear immediately locally, then automatically in the other browser. Refresh
restores accepted edits. The document starts empty after a server restart.
No sign-in, rich text, presence indicators or remote carets are included.

The server assigns a new writer ID on each connection, sends the accepted history
and visible projection in a consistent snapshot, and serializes validated batches
through `Replica.receive`. Each new batch advances a revision. Retries acknowledge
existing operation IDs without applying them again. Validation rejects the entire
batch before mutation if any operation is invalid. Each socket has an ordered
outbound queue, so joins cannot miss an edit between snapshot and subscription.

The browser retains accepted history, deleted anchors and unacknowledged edits.
It renders their union with the core's traversal rules. Native selections map to
stable character IDs, UTF-16 offsets convert to Unicode scalar gaps, and IME drafts
stay in the native textarea until composition commits once. On connection loss the
editor becomes read-only and preserves its local text for copying. Copy unsaved
text before reloading: an unacknowledged edit may exist only in that browser.
Offline editing, reconnect replay, persistence and authentication are outside scope.
This is a loopback demo; history and per-client outbound queues are unbounded.

### Verification

With the virtual environment active, install the browser test tools (Node 20+):

```sh
npm ci
npx playwright install chromium
python -m unittest discover -s tests -v
python demo.py
npm test
```

Stop any manually launched server on port 8000 before `npm test`; Playwright starts
and stops its own fresh server. Tests use independent Chromium contexts and cover deferred same-gap edits in both delivery orders, duplicate deliveries, deleted
anchors, repeated text, emoji, focus/selection, refresh, and connection loss.
Composition tests include synthetic event sequences and native Chromium IME
events driven through CDP. They do not replace a manual OS IME check.

For a manual walkthrough, open the shared URL in Chrome and Firefox, type multiline
text and emoji in each, replace selections, and type rapidly while the other browser
edits earlier in the text. Check that focus and the caret stay at the intended passage.
Use an installed OS IME to compose text while editing in the peer. Refresh after the
peer shows the edit and check that it remains. Stop the server, confirm the local
text remains selectable but read-only, copy any draft, restart and reload: the document
is empty. A true collision is reproduced deterministically by the automated tests'
test-only WebSocket gate; casual sequential typing does not establish a collision.

Verification limit: the automated Chromium suite was run here. The downloaded
Firefox test browser exited with `Could not find profile folder` before loading
the editor, so the manual Chrome/Firefox and OS IME walkthrough remains unverified.
