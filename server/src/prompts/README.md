# Route prompt registry

`route-prompts.source.json` is the human-editable prompt source. It contains common conversational rules, four condition behavior blocks/refinements, and the legacy RouteKind map that preserves the 30 registry keys.

`route-prompts.snapshot.v1.json` is the generated runtime artifact. The server reads only this snapshot and verifies every SHA-256 hash at startup. Do not hand-edit it.

The compiler emits one unified system prompt per condition. Every RouteKind in a condition therefore has the same prompt text and hash, while its existing `promptKey`, `routeKind`, intervention row, and analytics metadata remain unchanged. The legacy route strings remain in the editable source for data lineage and key enumeration but are not appended to runtime prompts.

The immediate speech goal and factual bounds are injected as Turn Metadata by `lib/routeContext.ts`. This metadata guides the current turn without acting as a sentence template. Address and follow-up answer the actual request first; build-on, mediation, backchannel, long-silence, greeting, summary, and closing keep their distinct goals through this dynamic block.

Information state has three deliberately separate layers. `byCandidate.*.revealedIds` records human-surfaced traits, `aiSurfacedIds` records Alex-surfaced traits for pooling DV and repetition prevention, and `humanConfirmedIds` records the human-grounded discussion board used by depth, summary eligibility, and intervention judgment. Summary and complete visible-board answers use the deduplicated visible-board union of human and Alex disclosures. Preference instead uses everything Alex legitimately knows: Alex's complete Z-profile notes plus every trait surfaced in the conversation. Existing sessions without `humanConfirmedIds` fall back to their legacy human-surfaced set.

Human and Alex trait extraction is committed before the next routing decision can read the ledger. Human extraction accepts only high-confidence affirmative assertions with an exact evidence span; generic positive/negative references, questions, hypotheticals, criterion statements, and reused evidence cannot surface traits.

Address, follow-up, long-silence, and build-on turns may receive an internal focus/depth control computed from recent human candidate focus and human-confirmed depth. It changes only the conversational subject; Turn Metadata controls the current goal. The internal block is never participant-facing, never stored as the response, and explicit metadata leakage is repaired before broadcast. Mediation, summary, closing, greeting, and backchannel routes do not receive a stay directive.

For address and follow-up routes, a scope-less notes request such as “what do you have?” is resolved against the current single-candidate human discussion focus. An explicit request for new information is limited to an actually unsurfaced Alex note. Explicit all-candidate, all-note, and complete visible-board requests bypass the one-trait cap and receive an exact deterministic answer. Live turns and the admin test-chat path share the same post-generation scope check and repair path.

Address, follow-up, build-on, and closing turns may receive a server-calculated internal preference cue derived from Alex's complete Z-profile plus the shared conversation. Exact fraction comparison returns either one highest-ratio candidate or every co-leading candidate among sufficiently covered profiles. The cue omits raw counts, ratios, thresholds, and calculation details; prompts translate only its single, co-leading, or insufficient outcome into natural chat and must not infer a different choice independently.

XAI remains declarative on discretionary contributions, and ACI remains grounded in small same-point questions. Those tendencies do not suppress normal task competence: every condition answers direct questions, and a genuinely ambiguous request may receive one clarification question. Every build-on first takes up the latest human point naturally, then marks a new note as additional or separate instead of falsely attributing it to the participant.

Leader mediation is a global cadence: after two successful C2/C4 build-ons, the next non-priority human turn receives mediation. Candidate changes, summaries, direct answers, and failed generations do not reset the count; only a successfully broadcast mediation does. Mediation summarizes the discussion state and gives one useful direction, without requiring conflict or a candidate switch.

Each condition behavioral block carries explicit manipulation markers, prohibitions against the opposite status/strategy, and three placeholder-based general style examples. Examples are patterns only; dynamic Turn Metadata supplies the function. The intervention V2 test suite checks condition orthogonality, same-condition prompt identity, routing cadence, request scope, factual ledger validation, and output guards.

After editing the source, run:

```sh
cd server
npm run prompts:compile
npm run test:intervention-v2
```

To re-import the original spreadsheet before compiling, run `npm run prompts:import -- "/absolute/path/to/prompt.csv"`. Re-importing replaces the source JSON, so use it only when the spreadsheet is intentionally authoritative.

The 30-entry registry is intentionally asymmetric: peer conditions have 6 routes, while leader conditions additionally have mediation, summary, and closing.
