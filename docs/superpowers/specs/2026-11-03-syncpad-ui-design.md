# Syncpad browser editor

Design for review | 3 November 2026

## What the user opens

Open the same URL in two independent browsers to edit one plain-text document. Each browser shows one multiline writing area and its own native caret or selection. An edit appears immediately where it was typed. The other browser receives it automatically. Users can type in the same gap and both insertions survive.

The document starts empty. A browser joining later opens on the current text. The normal screen has no toolbar, sign-in, presence count, remote caret or sync badge. Use a keyboard-accessible, visibly focusable textarea with an accessible name, readable wrapping and enough space to write on a narrow viewport. Preserve newlines and display pasted markup as plain text.

## Approaches

We chose WebSockets so the server can push edits immediately over a shared connection with each browser. Polling would keep the same screen and use ordinary requests, but visible latency would depend on the polling interval.

## How an edit travels

Use the existing Python Replica as the authoritative merge engine. The proposed browser adapter maintains a projection of visible character IDs and their text. On connection the server assigns a unique ASCII writer ID and sends a consistent snapshot containing that projection, the logical counter high-water mark and a revision. Include the accepted operation history so the browser can also resolve deleted anchors. Subscribe from the next revision so a concurrent join cannot miss an edit.

Translate each native edit against the pre-edit selection and visible IDs, including for repeated text. Delete only the selected IDs. Insert Unicode scalars in order, anchoring the first to the visible predecessor (or root), and each subsequent scalar to the previous one. Allocate IDs according to the core counter rule. Apply immediately to the local projection and send the operations as one ordered batch. Convert textarea offsets to scalar boundaries. During IME composition, preserve the native composition and commit the final replacement once.

Serialize accepted batches on the server, validate them before mutation, deduplicate by operation identity and merge through Replica.receive. Broadcast a revisioned visible projection and acknowledgement to the originating browser and the accepted operations to all browsers. For this local demo full projections are acceptable. A browser retains unacknowledged edits and renders the union of accepted and pending operations using the core traversal and tie-break rules whenever edits are pending. Retain deleted anchors for ordering. Match the browser renderer against the Python acceptance examples. Incoming updates must preserve focus, selection and typing position. Track selection boundaries against document IDs and fall back to the nearest surviving boundary if an anchor disappears. The wire encoding and adapter internals are builder choices.

## Proposed operating limits

Run one local server and open its URL in two browsers on the same computer. Keep history in memory for the lifetime of that process. Refreshing the page restores accepted text. Restarting the server starts a fresh document. Offline editing, persistent storage, authentication and rich text are outside this version.

Enable editing once the initial snapshot arrives. If the connection fails, keep the local text visible and selectable, switch to read-only, and show a brief message that the connection was lost and the user can copy their text before reloading. Reload rejoins from server state. An unacknowledged edit may exist only in the disconnected browser. No steady-state status UI is needed.

## Acceptance checks

| Check | Observable result |
|---|---|
| Join and refresh | Type in one browser, then open the URL in an independent browser profile. Both show the same document. Refresh after acknowledgement and the text remains. |
| True collision | Seed AB. Delay delivery so each browser inserts into the gap before seeing its peer. Each local insertion appears immediately. Release both batches in either order. Both browsers render both characters in the core's deterministic order. Duplicate delivery adds nothing. |
| Delete during insertion | Starting with AB, one browser deletes A while the other inserts y after A. Both settle on yB. |
| Editing while updates arrive | Type rapidly and replace selected text while a peer edits earlier in the document. Local input, caret and focus stay at the intended passage, and both views converge. Repeat with identical neighboring letters. |
| Native text input | Paste multiple lines containing emoji, replace a selection and commit composed text. Both browsers show identical characters and line breaks without splitting emoji surrogate pairs or duplicating composed text. |
| Loss of connection | Disconnect one browser with an edit pending. Its local text remains available to copy. Reload after service returns and both browsers show accepted server text. |

Keep the existing core tests and demo working. Provide a local launch command and a reproducible two-browser check in the README when implementing.
