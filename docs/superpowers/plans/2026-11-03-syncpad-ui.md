# Syncpad browser editor implementation plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task by task. Track progress with the checkboxes.

**Goal:** Let two independent browsers open the same URL and edit one shared plain-text document, preserving both edits when users type in the same gap.

**Architecture:** A local Python server serializes batches through the existing Replica. Each browser applies its own edits immediately and reconciles acknowledgements and remote edits by operation ID.

**Tech stack:** Python, aiohttp, native textarea, JavaScript ES modules, unittest, Node's built-in test runner and Playwright for browser tests. No frontend build step.

**Spec:** [Approved browser editor design](../specs/2026-11-03-syncpad-ui-design.md)

## Global constraints

- One local URL and one in-memory document per process. Refresh preserves accepted edits. A server restart starts empty.
- Keep the existing demo and core tests working. Follow the scalar indexes, stable IDs and ordering in syncpad.py.
- One accessible writing area. No toolbar, sign-in, presence count, remote caret or sync badge.
- The editor becomes writable after the initial snapshot. On disconnect preserve the local buffer for copying and make it read-only.

## Review focus

1. A join racing an edit must neither lose nor double-apply it.
2. An invalid final operation must leave the entire batch unapplied.
3. A peer deleting the anchor of a pending insertion must leave that insertion visible.
4. Identical neighboring letters and non-BMP characters must map to the intended character IDs.
5. A remote update during composition must preserve the draft and produce exactly one committed replacement.

## Files and order

| Task | Production files | Tests |
|---|---|---|
| 1. Document protocol | syncpad.py, document.py | tests/test_document.py |
| 2. Local transport | server.py, requirements.txt | tests/test_server.py |
| 3. Browser replica | web/replica.mjs | tests/replica.test.mjs |
| 4. Editor integration | web/index.html, web/editor.mjs, server.py | tests/browser/editor.spec.mjs, playwright.config.mjs, package.json and lockfile |
| 5. Collision verification | README.md | tests/browser/collision.spec.mjs |

### 1. Authoritative document and wire contract

- [x] Write unittest cases for Document.snapshot(actor) and Document.apply(actor, ops). Use JSON IDs of the form [counter, actor], insert records with kind/id/predecessor/character, and delete records with kind/id/target. Assert empty revision 0, seed AB in revision 1, and concurrent x/y after A at counter 3 from alice/bob yielding AxyB in both delivery orders. Replaying x must leave revision and text unchanged.
- [x] Add a batch with a valid insertion followed by an invalid scalar. Assert the entire snapshot is unchanged. Repeat for a reused ID with different content and a writer claiming another actor's ID.
- [x] Run `python3 -m unittest discover -s tests -p test_document.py -v`. Confirm the new tests fail on the missing API.
- [x] Implement Document and expose Replica.visible_ids() by reusing its traversal. Validate the whole batch before calling receive. Accept references to prior insertions in the batch or stored history, including deleted anchors. Keep unique operations in accepted order. Use positive JS-safe integer counters and ASCII actor IDs. Advance the revision once per batch containing new operations.
- [x] Return snapshot fields type, actor, revision, clock, ops and visible (ordered ID/character pairs). For apply return type=update, revision, ops (new operations), visible and ack (submitted IDs, including retries). The browser removes only its own acknowledged IDs.
- [ ] Run the full unittest suite with discovery under tests. Commit the protocol and its tests once green.

### 2. Local WebSocket transport

- [x] With aiohttp TestServer, open two sockets to /ws. Assert distinct actor IDs, snapshot first, the same accepted update on both sockets and an acknowledgement to the writer. Join during a submitted batch and assert the joiner receives it exactly once via snapshot or subsequent update. Close a client and verify the remaining client can edit. Send an invalid batch and verify no peer update or state change.
- [x] Run `python3 -m unittest discover -s tests -p test_server.py -v` in a venv with aiohttp installed. Observe missing create_app or unmet protocol behavior.
- [x] Implement server.create_app() and a loopback launch entry point. Accept JSON messages {type:"edit",ops:[...]}. Assign fresh connection-scoped writer IDs. Serialize snapshot registration and update enqueueing without intervening awaits. Drain one ordered outbound queue per socket outside that critical section. Reject bad batches and close the offending connection so optimistic state stays available to copy.
- [ ] Repeat the transport tests and full Python suite. Record the tested aiohttp dependency in requirements.txt and commit.

### 3. Optimistic browser replica

- [x] Use node:test against BrowserReplica(snapshot), replace(start,end,text), receive(update), and view(). Offsets are scalar gaps. replace returns the operations and applies them immediately. view returns ordered visible ID/character pairs. Assert that pending x survives an update deleting its predecessor A and that acknowledging x twice leaves xB. Assert a fresh insert counter exceeds the highest observed counter.
- [x] Cover core parity with fixed alice/bob IDs: reversed delivery yields AxyB, a deletion before its target hides it, and a child arriving first appears when its predecessor arrives. Check that receiving a previously seen revision cannot discard later pending edits.
- [x] Run `node --test tests/replica.test.mjs`. Observe the missing module or failing assertions.
- [x] Implement the module, retaining tombstones and indexing accepted and pending operations by both ID fields. Replay the union using the Python traversal order, including ASCII actor comparison on equal counters. Replacing a selection deletes the original IDs and chains inserts from the original left boundary. Validate renderer parity with the server projection when pending is empty.
- [ ] Repeat the Node tests and commit.

### 4. Native editor and connection lifecycle

- [x] Add Playwright tests that open /, await the writable named textbox, type multiline text, and refresh after a peer sees the change. Verify pasted markup remains literal. Test selection replacement in repeated text with a concurrent edit distinguishing the two equal letters. Replace an emoji beside an ASCII letter and check both browsers. Assert focus and caret stay at the same passage when a peer edits before it.
- [ ] Add a controlled composition sequence with a remote edit between compositionstart and compositionend. Assert one committed replacement plus the remote edit on both screens. Disconnect with a local batch held back and verify the exact local text remains selectable, further typing has no effect, and reload returns accepted text.
- [x] Configure Playwright to start python3 server.py on loopback. Run `npx playwright test tests/browser/editor.spec.mjs` and observe failures against the missing editor.
- [x] Serve / and the two ES modules. Implement a labelled, responsive textarea with a visible focus style and an error-only message. Open /ws on the page origin. Convert UTF-16 selections to scalar gaps at the adapter boundary. Capture pre-edit text, selection and IDs and derive replacements from the native input action and resulting text, using selection context to distinguish equal neighbors.
- [ ] Store selection as stable boundaries and preserve its direction. Map deleted boundaries to the nearest surviving gap in traversal order. During composition retain the initial target IDs and queue remote repainting until commit. Coalesce the final input and composition events into one batch. On close or error preserve the textarea value and make it read-only.
- [ ] Run the browser tests and earlier suites. Commit the editor, test tooling and verified dependency lockfile.

### 5. Prove a real collision and document the run

- [x] Write a Playwright test with two independent browser contexts on the same URL. Install a test-only WebSocket message gate before navigation to buffer outgoing edit frames while leaving the connection open. Seed AB and wait for both clients to see it before enabling the gate.
- [x] Insert x and y at gap 1. Assert local AxB and AyB before releasing either frame. Release both, duplicate one frame, and assert both clients show the exact ordering predicted by their assigned actor IDs. Repeat from fresh server state with reversed release order. In a separate run delete A while inserting y after it and assert yB on both.
- [x] Run `npx playwright test tests/browser/collision.spec.mjs`. Demonstrate test sensitivity by temporarily dropping one held frame and observing a failed convergence assertion, then restore delivery.
- [x] Document venv setup, dependency installation, launch via python3 server.py, the shared URL http://127.0.0.1:8000/, and a manual Chrome/Firefox walkthrough. Include test setup (npm ci and npx playwright install chromium) and explain refresh, disconnect and restart behavior.
- [ ] Verify `python3 -m unittest discover -s tests -v`, `python3 demo.py`, `node --test tests/replica.test.mjs` and `npx playwright test`. Expect all tests green and the demo to report agreement. Complete the manual cross-browser walkthrough, including native IME input, before claiming it verified. Commit the collision tests and README.

## Implementation verification — 3 November 2026

All five deliverables are implemented. Final verification: 17 Python tests,
7 Node tests, and 10 Chromium browser tests pass; demo ends in AxyB. A fresh
review found the repeated-text Backspace ID bug; its collision regression
failed with aaX before the fix and passes with aX after the fix. Withholding
one outgoing frame makes the collision test fail as intended.

Changes remain uncommitted in the existing checkout because git metadata is
read-only in this workspace. Steps mentioning commits remain unchecked for
that reason. The manual Chrome/Firefox and OS IME walkthrough is still pending:
Firefox exited before loading the page with Could not find profile folder.
Native Chromium IME events were verified through CDP.
