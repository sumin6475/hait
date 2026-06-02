# Agent 4 — Supervisor (design note; not sent to any LLM)

The Supervisor is implemented as deterministic TypeScript logic, not an
LLM call, even though `config/llm_models.yaml` reserves a model slot for
it. The decision: there is no semantic synthesis the Supervisor does that
the Critic's structured diff hasn't already provided, so an extra LLM call
would add cost without adding signal.

If a future change introduces non-deterministic routing (e.g. comparing
multiple candidate revisions before picking one to send back to the
Architect), this file becomes the LLM system prompt and `agent4_supervisor.ts`
gets a `callAgent` invocation. Until then, the spec here exists as a
behavioral contract.

## Behavioral contract

Per CLAUDE.md §7.5. Inputs: Critic's evaluation + current `loop_count`.

1. If `passed` is true AND scores satisfy
   `status_target >= 4.5 && status_opposite <= 3.0 && strategy_target >= 4.5 && strategy_opposite <= 3.0`
   → write `core_prompts/{condition}_specification.yaml`, append an
   `_audit` block, log `supervisor.passed`, return done.

2. Else if `loop_count < 10` → emit a diff-feedback string for the
   Architect (via `formatDiffForArchitect` from `agent3_critic.ts`),
   increment `loop_count`, return continue.

3. Else → write `core_prompts/{condition}_specification.FAILED.yaml` with
   the full audit log, log `supervisor.failed_max_iterations`, return done.

## Soft Entropy Rule (CLAUDE.md §7.5, §17.4)

After 3 consecutive stagnant iterations (per-sub-scale improvement <
`soft_entropy_min_improvement` = 0.3), lower the pass threshold for the
lowest-scoring sub-scale by `soft_entropy_decay` = 0.2 (one-time, logged).
This prevents infinite loops while preserving the rest of the bar.

The Supervisor logs Soft Entropy as a WARN; reviewers are expected to
inspect post-run and either accept the loosened bar or rerun with manual
guidance.
