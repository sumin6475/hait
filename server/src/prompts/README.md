# Route prompt registry

`route-prompts.source.json` is the human-editable prompt source. It contains the common blocks, four condition behavior blocks, and the one-to-one RouteKind contracts.

`route-prompts.snapshot.v1.json` is the generated runtime artifact. The server reads only this snapshot and verifies every SHA-256 hash at startup. Do not hand-edit it.

Route contracts are static, while live continuity and coverage are injected by `lib/routeContext.ts`. Long-silence turns receive the last two Alex messages, subsequent human updates, and human-grounded confirmed coverage so the model can avoid repeating an already-issued request.

Information state has three deliberately separate layers. `byCandidate.*.revealedIds` records human-surfaced traits, `aiSurfacedIds` records Alex-surfaced traits for pooling DV and repetition prevention, and `humanConfirmedIds` records the human-grounded discussion board used by depth, summary eligibility, and intervention judgment. Summary, closing, and preference use the same deduplicated visible-board union of human and Alex disclosures. Existing sessions without `humanConfirmedIds` fall back to their legacy human-surfaced set.

Address, follow-up, long-silence, and build-on turns may receive an internal focus/depth control computed from recent human candidate focus and human-confirmed depth. It changes only the conversational subject; the static Route Contract still controls status, strategy, and speech act. The internal block is never participant-facing, never stored as the response, and explicit metadata leakage is repaired before broadcast. Mediation, summary, closing, greeting, and backchannel routes do not receive a stay directive.

For address and follow-up routes, a scope-less notes request such as “what do you have?” is resolved against the current single-candidate human discussion focus. Unless the participant explicitly requests all candidates, all notes, or a complete list for one named candidate, the response is limited to that candidate and at most one trait. Live turns and the admin test-chat path share the same post-generation scope check and one-repair safety path.

Address, follow-up, build-on, and closing turns also receive a server-calculated internal preference cue derived from the visible board. Preference is unavailable while any candidate has zero visible MISSES, because a MATCH/MISS ratio cannot yet compare the full field. Once eligible, exact fraction comparison returns either one highest-ratio candidate or every co-leading candidate. The cue omits raw counts, ratios, thresholds, and calculation details; prompts translate only its single, co-leading, or insufficient outcome into natural chat and must not infer a different choice from Alex's private notes.

The XAI conditions (C1/C2) use declarative output only: no questions, question marks, participant callouts, or requests for information. This condition-level safeguard is repeated in the XAI long-silence contracts because silence re-entry is especially prone to drifting into ACI-style solicitation.

Each condition behavioral block carries three layers that are compiled into every one of its routes: explicit manipulation markers, prohibitions against the opposite status/strategy, and three placeholder-based general style examples. Examples are patterns only and cannot add a conversational function that the active Route Contract does not permit. The intervention V2 test suite checks this orthogonality block and the specific contract for all 30 condition-route pairs.

After editing the source, run:

```sh
cd server
npm run prompts:compile
npm run test:intervention-v2
```

To re-import the original spreadsheet before compiling, run `npm run prompts:import -- "/absolute/path/to/prompt.csv"`. Re-importing replaces the source JSON, so use it only when the spreadsheet is intentionally authoritative.

The 30-entry registry is intentionally asymmetric: peer conditions have 6 routes, while leader conditions additionally have mediation, summary, and closing.
