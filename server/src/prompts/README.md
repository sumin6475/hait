# Route prompt registry

`blocks/` is the human-editable prompt source: one file per block. Six `common.*.ts` blocks are
shared byte-for-byte by all four conditions; `c1..c4.behavioral.ts` and `c1..c4.refinement.ts`
carry everything that differs between them, which was 15–19% of a compiled prompt before 1.11.0 (outdated; not re-measured).
`route-contracts.ts` holds the legacy RouteKind map that preserves the 30 registry keys.
`blocks/index.ts` is what the compiler reads.

There is no `route-prompts.source.json`. It was one JSON file holding every block as an
escaped string, which made a prompt edit unreadable in a diff. Splitting it changed no
output: the snapshot is byte-identical across the move, and that is the only post-condition
the split had to meet. `prompts:import` is disabled for the same reason — it would recreate
that JSON as a second source of truth.

`route-prompts.snapshot.v1.json` is the generated runtime artifact. The server reads only this snapshot and verifies every SHA-256 hash at startup. Do not hand-edit it.

The compiler emits one unified system prompt per condition. Every RouteKind in a condition therefore has the same prompt text and hash, while its existing `promptKey`, `routeKind`, intervention row, and analytics metadata remain unchanged. The legacy route strings remain in the editable source for data lineage and key enumeration but are not appended to runtime prompts.

The fixed condition prompt is sent in the system role and is never rebuilt per turn. `conversationObserver.ts` reads the complete transcript on every human epoch, updates cumulative thread/addressee/floor/Alex-relation state, and deterministically renders that state into plain English. `interventionJudge.ts` receives that state plus the complete transcript and chooses whether to speak and the communicative act. Exact-name address remains a deterministic fast path; if Observer is unavailable, the frozen pre-Observer pipeline is used as a degraded-mode rollback instead of making the system globally silent. **Outdated (2026-09-14):** in the default `ledger_active` mode an unavailable Observer, after one re-observe, makes that turn silent, and the exact-name fast path is acted on only in `legacy` mode.

The unified generator receives a versioned dynamic input contract. Server-authored current situation, communicative act, evidence sequence numbers, request scope, and exact factual bounds are sent in the developer role. The complete raw transcript is sent separately in the user role. This separation prevents transcript text from masquerading as server control while preserving exact candidate letters, numbers, and message evidence. For audit/test compatibility, `buildRouteUserContext` also exposes a combined view, but live model calls use the separated fields. Address, follow-up, build-on, mediation, backchannel, and long-silence are analytics route names around this one generator, not separate condition prompts.

No conversation thread expires because a fixed number of messages elapsed. Threads close only from observed resolution, topic replacement, or closure. Low-confidence or internally inconsistent Observer output is re-observed; there is no active semantic Resolver between Observer and Judge.

Information state has three deliberately separate layers. `byCandidate.*.revealedIds` records human-surfaced traits, `aiSurfacedIds` records Alex-surfaced traits for pooling DV and repetition prevention, and `humanConfirmedIds` records the human-grounded discussion board used by depth, summary eligibility, and intervention judgment. Summary and complete visible-board answers use the deduplicated visible-board union of human and Alex disclosures. Preference instead uses everything Alex legitimately knows: Alex's complete Z-profile notes plus every trait surfaced in the conversation. Existing sessions without `humanConfirmedIds` fall back to their legacy human-surfaced set.

Human and Alex trait extraction is committed before the next routing decision can read the ledger. Human extraction accepts only high-confidence affirmative assertions with an exact evidence span; generic positive/negative references, questions, hypotheticals, criterion statements, and reused evidence cannot surface traits.

Address, follow-up, long-silence, and build-on turns may receive an internal focus/depth control computed from recent human candidate focus and human-confirmed depth. It changes only the conversational subject; Turn Metadata controls the current goal. The internal block is never participant-facing, never stored as the response, and explicit metadata leakage is repaired before broadcast. Mediation, summary, closing, greeting, and backchannel routes do not receive a stay directive.

For address and follow-up routes, a scope-less notes request such as “what do you have?” is resolved against the current single-candidate human discussion focus. An explicit request for new information is limited to an actually unsurfaced Alex note. Explicit all-candidate, all-note, and complete visible-board requests receive an exact deterministic answer. How many facts an ordinary turn may state is the Judge's to name (`docs/adr/0010`); the request-scope block bounds the candidate, not the count. Live turns and the admin test-chat path share the same post-generation scope check and repair path.

Address, follow-up, build-on, and closing turns may receive a server-calculated internal preference cue derived from Alex's complete Z-profile plus the shared conversation. Exact fraction comparison returns either one highest-ratio candidate or every co-leading candidate among sufficiently covered profiles. The cue omits raw counts, ratios, thresholds, and calculation details; prompts translate only its single, co-leading, or insufficient outcome into natural chat and must not infer a different choice independently.

XAI remains declarative on discretionary contributions, and ACI remains grounded in small same-point questions. Those tendencies do not suppress normal task competence: every condition answers direct questions, and an ambiguous request is answered on its most reasonable reading rather than sent back as a clarification question — repeated clarification questions were the measured failure in T-C2-046 and T-C4-022. Every build-on first takes up the latest human point naturally, then marks a new note as additional or separate instead of falsely attributing it to the participant.

Leader mediation is a global cadence: after two successful C2/C4 build-ons, the next non-priority human turn receives mediation. Candidate changes, summaries, direct answers, and failed generations do not reset the count; only a successfully broadcast mediation does. Mediation summarizes the discussion state and gives one useful direction, without requiring conflict or a candidate switch.

Each condition behavioral block carries explicit manipulation markers, prohibitions against the opposite status/strategy, and placeholder-based general style examples — three in C1–C3, nine in C4, where the leader's question is the manipulation and one example per situation was not enough. Examples are patterns only; dynamic Turn Metadata supplies the function. The intervention V2 test suite checks condition orthogonality, same-condition prompt identity, routing cadence, request scope, factual ledger validation, and output guards.

After editing the source, run:

```sh
cd server
npm run prompts:compile
npm run test:intervention-v2
```

(Outdated, 2026-09-14: `prompts:import` is disabled and the source JSON it replaced no longer exists; see the top of this file.)

The 30-entry registry is intentionally asymmetric: peer conditions have 6 routes, while leader
conditions additionally have mediation, summary, and closing. **The asymmetry is in which routes
the router can reach, not in prompt text** — all six C1 keys carry one identical prompt, and all
nine C4 keys carry another. Reading the 30 keys as 30 prompts overstates what the registry holds.
