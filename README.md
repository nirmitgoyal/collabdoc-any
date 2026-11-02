# syncpad

syncpad is a collaborative document editor you build from scratch. Picture something like Google Docs or Canva, where several people open the same document at once and all edit it at the same time. Each person's edits show up for everyone else, and the catch is that when two people change the same document concurrently, their edits can't clobber each other — everyone has to end up looking at the exact same document. Your job is the part underneath that: how the document is stored, how concurrent changes come in, and how they get reconciled so all the clients converge on one shared state.

## Your task

You have two jobs.

1. **Build the core and get it working.** A document model, a way to accept edit operations from multiple users at the same time, and the logic to reconcile those concurrent edits so every client deterministically lands on the same final document. The document itself can be whatever you want — plain text, a list of elements, a tree — so pick the simplest model that still lets two people's edits genuinely collide, and you don't need to build a UI or a real network around it. The reconciliation is the heart of this exercise, so build it yourself — reaching for an off-the-shelf collaboration engine like Yjs, Y-Sweet, Automerge, or ShareDB to do the merging defeats the point. Libraries for plumbing (a web framework, a websocket transport) are fine; the convergence logic is yours. What matters is that the clients end up in agreement — feed the same concurrent edits in different orders and every client lands on the identical final document. Resolving a clash by picking one edit over another is completely fine; what's not fine is two clients ending up in different states. Give yourself a way to feed in interleaved edits from two users and read back the converged document.
2. **Push it further toward production readiness.** The interesting part is where you go from the basics. You won't get it fully production-ready in the time you have, and we don't expect you to. Treat this like real code you'd be happy to hand a teammate, decide what would matter most for putting it in front of real users, and push it as far as you can on the things you pick. What "production ready" means here, and how far you grow the functionality beyond the core, is yours to define. Be ready to walk through your plan and defend why you tackled what you did first.
  One thing that's *not* in scope is deployment. We're not hosting this anywhere, so skip Dockerfiles, CI, and infra and focus on the code itself.

We care more about your judgment on what to tackle first than about a long list of half-finished features.

## Time

Aim for **60 minutes**. This is practice, so going over is fine, but your submission records exactly how long you took, and that time factors into the evaluation.

## Tools

Use whatever you'd use day to day. AI assistants (Cursor, Copilot, ChatGPT, Claude), search, library docs, Stack Overflow. Anything goes. We want to see how you actually work, not how you perform without your normal tooling.

## Building it

This repo is intentionally empty except for this README, so you're starting from a blank page. Set it up in whatever language and framework you like, using your own toolchain (your own package manager, test runner, and build commands).

When you're done, run `npx @hellointerview/ai-coding submit` to submit your code.

## Git

This is a regular git repo, so use git however you like. Commit as you go, make branches, do whatever fits how you normally work. It won't get in the way and we're not going to fight your workflow.

The one thing to know is there's nowhere to push. When you run `npx @hellointerview/ai-coding submit` we bundle up your work and submit it for you, so commits are just for your own benefit, not how you turn the exercise in. Your full set of changes is included either way, whether you committed them or not.
