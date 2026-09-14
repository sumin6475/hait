# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## HAIT-specific notes

- The open repair work lives in `.scratch/conversation-repair/issues/`. One issue
  per open gate item, each written to stand alone — the defect as observed, the
  session that evidenced it, and the constraints it must not violate. Do not send
  a reader to the checkpoint to understand an issue.
- `CONVERSATION-REPAIR-CHECKPOINT.md` (root) was rewritten on 2026-09-08 to hold
  the working rules and invariants; the measurement history is in
  `docs/measurements.md`. It is not the place to track open work. A settled decision belongs in
  `docs/adr/`, a term in `CONTEXT.md`, and open work in the tracker; if you are
  about to add any of the three to the checkpoint, it goes in one of those
  instead.
- Session exports and server logs used as evidence contain real participant text.
  Reference them by session id (`T-C1-027`) rather than pasting transcript
  content into an issue file.
