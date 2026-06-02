# CLAUDE.md — Prompt Management System for Hidden Profile × Human-AI Experiment

> **Read this file at the start of every session.** It is the constitution of this project. If anything you are about to do contradicts these rules, stop and ask the user before proceeding.

---

## 0. Quick Reference (Read First Every Session)

- **Goal:** Produce four English-language YAML prompt specifications (`leader_xai`, `leader_aci`, `peer_xai`, `peer_aci`) for a 2 × 2 between-subjects HCDE experiment. Every prompt sentence must carry `rationale` and `citations` metadata.
- **Stack:** TypeScript (Node 20+), pnpm, LangGraph.js, Zod, js-yaml, Anthropic SDK, Bottleneck.
- **LLMs:** Anthropic only. Haiku 4.5 (Scout), Sonnet 4.6 (Grounder/Architect/Supervisor), Opus 4.7 with extended thinking (Critic).
- **External APIs:** OpenAlex (search) → Semantic Scholar (enrichment). DOI is the canonical join key.
- **Language:** All generated artifacts in **English only**. Korean source materials are reference-only inputs. Hangul Unicode (`\uAC00-\uD7A3`) in any committed artifact is a lint failure.
- **Never modify** `config/common_framework.yaml` without explicit user approval. It is the experimental control.
- **Never generate** a `prompt_component` without `text` + `rationale` + `citations`. Zod will reject it; do not bypass.
- **Trigger logic lives in a separate repository.** This repo defines only WHAT the AI says when called, never WHEN it is called.

---

## 1. Project North Star

This is **not** a typical software project. The deliverables are **experimental stimuli** for a Human-Centered Design & Engineering master's thesis.

The system produces four prompt specifications that will be deployed in a 2 × 2 between-subjects laboratory experiment on group decision-making in Hidden Profile tasks (Stasser & Titus, 1985). Every sentence in every prompt must be:

1. **Theoretically grounded** — traceable to a peer-reviewed paper in `knowledge_base/validated_kb.md`.
2. **Operationally defined** — verifiable via the manipulation checks in `config/manipulation_checks.yaml` (Sections 6.1 and 6.2 of the experiment design).
3. **Orthogonal** — variation in Status (Leader/Peer) and Strategy (XAI/ACI) must be independent. A Leader_ACI prompt must not bleed into Peer-like softness; a Peer_XAI prompt must not bleed into Leader-like authority.
4. **Reproducible** — frozen via git so a reviewer six months later can verify the exact stimulus used.

**Optimizing for code elegance, brevity, or DRY abstractions at the expense of these four properties is wrong.** When in doubt, choose academic rigor over engineering convenience.

---

## 2. Architecture: Five-Agent Pipeline

```
┌───────────────────────────────────────────────────────────────┐
│  AGENT 0 — Scout (Haiku 4.5)                                  │
│  OpenAlex search → 50–100 candidates → S2 enrichment          │
│  → Map-Reduce 5-point rubric → 10–15 validated papers         │
│  Output: knowledge_base/validated_kb.md                       │
└───────────────────────────────────────────────────────────────┘
                            ↓
┌───────────────────────────────────────────────────────────────┐
│  AGENT 1 — Grounder (Sonnet 4.6)                              │
│  validated_kb + experiment design → Linguistic Checklist      │
│  per condition with theory anchors and citation bindings      │
│  Output: 4 in-memory checklists (Leader, Peer, XAI, ACI)      │
└───────────────────────────────────────────────────────────────┘
                            ↓
┌───────────────────────────────────────────────────────────────┐
│  AGENT 2 — Architect (Sonnet 4.6)                             │
│  Checklists + common_framework → 4 condition YAML drafts      │
│  Each prompt_component carries (text, rationale, citations)   │
│  Output: core_prompts/{condition}_specification.yaml          │
└───────────────────────────────────────────────────────────────┘
                            ↓
            ┌───────────────────────────────────┐
            │  AGENT 3 — Critic (Opus 4.7)      │
            │  Two sub-roles per call:          │
            │  (a) Mock Chat: simulate 2 human  │
            │      teammates × 5+ turns with    │
            │      shared-info bias persona     │
            │  (b) Score: rate manipulation     │
            │      check perception items 1-7   │
            │  Output: scores + diff feedback   │
            └───────────────────────────────────┘
                            ↓
            ┌───────────────────────────────────┐
            │  AGENT 4 — Supervisor (Sonnet)    │
            │  If score ≥ threshold (4.5/5):    │
            │      → emit final YAML            │
            │  Else:                            │
            │      → route diff back to Agent 2 │
            │  Soft Entropy after 3 failures.   │
            │  Hard halt at 10 iterations.      │
            └───────────────────────────────────┘
```

Each agent receives a strongly-typed `AgentState` (defined in `src/state/agentState.ts`) and emits a strongly-typed delta. There is no free-form text passing between agents.

---

## 3. Non-Negotiable Rules

These rules cannot be overridden by user requests during a coding session. If the user asks Claude Code to violate one, surface the conflict and ask the user to either (a) document a permanent exception in this file, or (b) reconsider the request.

### 3.1 The Four Conditions Are Independent Assets

The four condition files (`leader_xai`, `leader_aci`, `peer_xai`, `peer_aci`) are **independent finished products**, not modular compositions of two variables. Do not introduce a `LeaderLayer` module that is shared across `leader_xai` and `leader_aci`. The 2 × 2 design depends on interaction effects, and module reuse creates a hidden coupling that can corrupt the experimental manipulation. This is **intentional duplication**, not a refactoring opportunity.

### 3.2 Every Prompt Component Requires Citations

A `prompt_component` without at least one valid citation referencing a paper in `validated_kb.md` is invalid. Zod will reject it at parse time. Do not work around this by adding placeholder citations or "TODO" entries. If a sentence cannot be grounded, it does not belong in the prompt.

### 3.3 Trigger Logic Is Out of Scope

The AI intervention trigger logic (MessageCountTrigger, TimeIntervalTrigger, LongSilenceTrigger, SharedInfoTrigger) lives in a separate repository (the experiment runtime). **This repository defines only WHAT the AI says when called, not WHEN it is called.**

- Condition YAML files MUST NOT contain trigger vocabulary. Banned tokens (lint-enforced): `every N messages`, `after N seconds`, `silence`, `interval`, `periodically intervene`, `trigger`, `threshold`, `polling`.
- The only acknowledgment of the trigger system goes in `common_framework.yaml` under `agent_calling_model`: a one-to-two-sentence anchor that says "You are called by an external scheduler. Respond as if entering an ongoing conversation. Do not greet each turn as a new arrival. Pace your contributions across multiple intervention opportunities."

### 3.4 English-Only for All Artifacts

- All committed artifacts in `config/`, `core_prompts/`, `knowledge_base/`, `src/`, `scripts/`, and `tests/` must be in English.
- Korean source materials (the user's brainstorming notes, Notion exports, etc.) are reference inputs only. Agents that receive Korean input must produce English output.
- Code comments, error messages, Zod error strings, log messages: English.
- A pre-commit hook (`tests/lint_hangul.test.ts`) scans for `\uAC00-\uD7A3` and fails the commit if any Hangul codepoint is detected outside of the `docs/_kor_reference/` directory (which is gitignored).

### 3.5 The Common Framework Is Frozen

`config/common_framework.yaml` contains the Hidden Profile dataset, the Common Prompt (Section 4.4 of the experiment design), the calculation rule, and the agent_calling_model anchor. **Agents must not modify this file.** Only the user, via manual edits, may change it. Modifications break experimental control. The file is checksummed at pipeline start; mismatches halt the run.

### 3.6 The CRITICAL Guardrail Tag Survives All Layers

The positive-to-negative ratio calculation rule from the Common Prompt is the single most likely thing for the LLM to drop under attention pressure. It must be wrapped in a `[CRITICAL SYSTEM RULE]` tag in the rendered system prompt, and that tag must appear **after** all variable layers (Status, Strategy) so it has recency advantage. Agent 2 must place it last when compiling.

### 3.7 No Fuzzy Matching for Citations

Citation strings must match paper keys in `validated_kb.md` exactly. No Levenshtein, no normalization, no "did you mean." Misspelled citations are bugs and must halt the pipeline so the user can fix them.

---

## 4. Tech Stack and Conventions

### 4.1 Stack

- **Runtime:** Node.js 20+ (ESM, `"type": "module"`)
- **Language:** TypeScript 5.x, `strict: true`, `noUncheckedIndexedAccess: true`
- **Package manager:** pnpm (lockfile committed)
- **Orchestration:** `@langchain/langgraph` (TypeScript bindings)
- **LLM SDK:** `@anthropic-ai/sdk`
- **Schema validation:** `zod` (use `.strict()` on object schemas to reject unknown keys)
- **YAML I/O:** `js-yaml`
- **Rate limiting:** `bottleneck` (separate limiter per external API)
- **HTTP client:** native `fetch` (Node 20+ has it natively, no axios needed)
- **Testing:** `vitest`
- **Logging:** `pino` (structured JSON logs)

### 4.2 File Naming

- YAML files: `snake_case.yaml`
- TypeScript files: `camelCase.ts`
- Agent prompt files: `agent{0-4}.system.md`
- Condition files: `{status}_{strategy}_specification.yaml` (always lowercase)

### 4.3 Versioning

- Each YAML asset carries a `version` field using semver (`1.0.0`, `1.0.1`, `1.1.0`).
- `last_updated` is ISO 8601 date (`YYYY-MM-DD`).
- Any change to `text`, `rationale`, or `citations` of a `prompt_component` bumps the version. Patch bump for wording, minor bump for citation changes, major bump for component additions/removals.

### 4.4 Determinism

- Anthropic API calls use `temperature: 0.2` for Critic and Supervisor, `temperature: 0.4` for Grounder and Architect, `temperature: 0.0` for Scout's rubric scoring.
- Do **not** send `top_p` alongside `temperature`. Current Anthropic models reject the combination (`temperature` and `top_p` cannot both be specified). Omitting `top_p` is equivalent to `top_p: 1`, so variance stays under temperature-only control.
- Seed every Mock Chat session with a deterministic seed derived from `{condition}_{loop_iteration}` so re-runs are reproducible.

---

## 5. Directory Structure

```
prompt-management-system/
├── CLAUDE.md                          # This file. Constitution.
├── README.md                          # Human-readable project intro.
├── .env.example                       # API key placeholders.
├── .gitignore                         # Excludes .env, node_modules, docs/_kor_reference/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
│
├── config/
│   ├── common_framework.yaml          # FROZEN. HP dataset, Common Prompt, agent_calling_model, CRITICAL rules.
│   ├── manipulation_checks.yaml       # Sections 6.1 and 6.2 verbatim. Critic's scoring rubric source.
│   ├── thresholds.yaml                # Pass criteria (≥4.5/5), loop limit (10), Soft Entropy decay (0.2).
│   ├── llm_models.yaml                # Agent → model mapping. Single source of truth for model strings.
│   ├── lint_rules.yaml                # Orthogonality banlists per condition.
│   └── seed_papers.yaml               # P0/P1/P2/Done/Reading from user's literature list.
│
├── knowledge_base/
│   ├── candidate_pool.json            # Agent 0 stage 1 output. 50–100 papers with metadata.
│   ├── validated_kb.md                # Agent 0 stage 2 output. 10–15 papers + compressed rationale.
│   └── citation_index.json            # Mapping from short citation keys → full metadata.
│
├── core_prompts/                      # FINAL ARTIFACTS. Output of full pipeline.
│   ├── leader_xai_specification.yaml
│   ├── leader_aci_specification.yaml
│   ├── peer_xai_specification.yaml
│   └── peer_aci_specification.yaml
│
├── appendix/                          # Generated. Do not edit by hand.
│   ├── prompt_literature_mapping.md
│   └── prompt_literature_mapping.csv
│
├── cache/                             # COMMITTED to git for reproducibility.
│   ├── openalex/                      # {doi}.json or {openalex_id}.json
│   └── s2/                            # {doi}.json
│
├── src/
│   ├── index.ts                       # Entry point. Wires up the graph.
│   ├── schemas/
│   │   ├── prompt.schema.ts           # Zod: PromptComponent, ConditionSpec.
│   │   ├── paper.schema.ts            # Zod: CandidatePaper, ValidatedPaper.
│   │   └── state.schema.ts            # Zod: AgentState (full pipeline state).
│   ├── state/
│   │   └── agentState.ts              # TypeScript AgentState type + reducers.
│   ├── agents/
│   │   ├── agent0_scout.ts
│   │   ├── agent1_grounder.ts
│   │   ├── agent2_architect.ts
│   │   ├── agent3_critic.ts
│   │   └── agent4_supervisor.ts
│   ├── prompts/                       # System prompts for each agent.
│   │   ├── agent0.system.md
│   │   ├── agent1.system.md
│   │   ├── agent2.system.md
│   │   ├── agent3.system.md
│   │   └── agent4.system.md
│   ├── graph/
│   │   └── workflow.ts                # LangGraph.js StateGraph definition.
│   ├── external/
│   │   ├── openalex.ts                # OpenAlex client + rate limiter.
│   │   ├── semanticScholar.ts         # S2 client + rate limiter.
│   │   └── cache.ts                   # File-based DOI-keyed cache layer.
│   ├── llm/
│   │   ├── anthropic.ts               # Anthropic SDK wrapper with caching headers.
│   │   └── tools.ts                   # Tool definitions for structured output.
│   └── lib/
│       ├── doi.ts                     # DOI normalization.
│       ├── citations.ts               # Citation key resolution + validation.
│       └── yaml_io.ts                 # YAML read/write with schema validation.
│
├── scripts/
│   ├── scout.ts                       # Phase 2 entry: run Agent 0 alone.
│   ├── build_condition.ts             # Phase 3 entry: build one condition end-to-end.
│   ├── build_all.ts                   # Phase 3 entry: build all four conditions.
│   ├── generate_appendix.ts           # Phase 4 entry: render Appendix Markdown + CSV.
│   └── verify_repro.ts                # Compare cached snapshot vs fresh API call.
│
├── tests/
│   ├── lint_hangul.test.ts
│   ├── lint_orthogonality.test.ts
│   ├── lint_trigger_vocab.test.ts
│   ├── schema_validation.test.ts
│   ├── citation_resolution.test.ts
│   └── frozen_common.test.ts          # Asserts common_framework.yaml checksum unchanged in CI.
│
└── docs/
    ├── architecture.md                # Diagrams and design rationale.
    ├── api_keys.md                    # How to obtain OpenAlex + S2 keys.
    └── _kor_reference/                # GITIGNORED. Korean brainstorming notes.
```

---

## 6. Schemas

The schemas below are authoritative. Implement them in `src/schemas/` as Zod, then derive TypeScript types via `z.infer<typeof Schema>`.

### 6.1 PromptComponent

```typescript
import { z } from "zod";

export const PromptComponentSchema = z.object({
  id: z.string().regex(/^[a-z_]+_\d{2}$/, "id must be snake_case + 2-digit suffix, e.g. status_setup_01"),
  text: z.string().min(20, "text must be substantive (≥20 chars)").max(2000),
  rationale: z.string().min(30, "rationale must explain the theoretical mechanism, not restate text"),
  citations: z.array(z.string()).min(1, "every component requires at least one citation"),
  theory_anchor: z.enum([
    "status_characteristics_theory",
    "information_asymmetry_model",
    "biased_information_sampling",
    "contrastive_explanation",
    "facilitative_questioning",
    "nudge_choice_architecture",
    "proactive_intervention",
    "common_ground_calculation",
  ]).optional(),
}).strict();

export type PromptComponent = z.infer<typeof PromptComponentSchema>;
```

### 6.2 ConditionSpec

```typescript
export const ConditionSpecSchema = z.object({
  condition: z.enum(["leader_xai", "leader_aci", "peer_xai", "peer_aci"]),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  prompt_components: z.array(PromptComponentSchema).min(3),
  manipulation_check_alignment: z.object({
    status_perception_target: z.enum(["leader", "peer"]),
    strategy_perception_target: z.enum(["xai", "aci"]),
  }),
}).strict();
```

### 6.3 ValidatedPaper

```typescript
export const ValidatedPaperSchema = z.object({
  citation_key: z.string().regex(/^[A-Z][a-zA-Z]+(EtAl)?_\d{4}$/, "e.g. Stasser_1985 or BergerEtAl_1972"),
  full_citation: z.string(),
  doi: z.string().nullable(),
  openalex_id: z.string().nullable(),
  semantic_scholar_id: z.string().nullable(),
  tldr: z.string().nullable(),
  utility_score: z.number().min(0).max(5),
  actionable_insight: z.string(),
  theory_anchors: z.array(z.string()),
  source_tier: z.enum(["P0", "P1", "P2", "Done", "Reading", "Discovered"]),
}).strict();
```

### 6.4 AgentState

```typescript
export const AgentStateSchema = z.object({
  // Phase 2 artifacts
  seed_paper_list: z.array(z.unknown()),
  search_keywords: z.array(z.string()),
  candidate_paper_pool: z.array(z.unknown()),
  validated_knowledge_base: z.array(ValidatedPaperSchema),

  // Phase 3 working state
  current_condition: z.enum(["leader_xai", "leader_aci", "peer_xai", "peer_aci"]),
  linguistic_checklist: z.record(z.string(), z.array(z.string())).optional(),
  prompt_draft: ConditionSpecSchema.optional(),
  mock_chat_log: z.array(z.object({
    turn: z.number(),
    speaker: z.enum(["human_1", "human_2", "ai"]),
    content: z.string(),
  })).default([]),
  evaluation_scores: z.object({
    status_target: z.number().min(1).max(7),
    status_opposite: z.number().min(1).max(7),
    strategy_target: z.number().min(1).max(7),
    strategy_opposite: z.number().min(1).max(7),
  }).optional(),
  loop_count: z.number().int().min(0).default(0),
  pass_threshold: z.number().default(4.5),
}).strict();
```

---

## 7. Per-Agent Specifications

### 7.1 Agent 0 — Scout

- **Model:** `claude-haiku-4-5-20251001`
- **Temperature:** 0.0 (deterministic scoring)
- **Inputs:** `config/seed_papers.yaml`, `config/common_framework.yaml` (for context only)
- **External calls:** OpenAlex search, Semantic Scholar enrichment
- **Output:** `knowledge_base/candidate_pool.json`, `knowledge_base/validated_kb.md`

**Seed handling rule (confirmed by user):**
- P0 + Done papers are **force-included**. They skip the rubric and enter `validated_kb.md` directly as `source_tier: P0` or `Done`.
- P1, P2, and Reading papers enter the candidate pool as seeds for keyword expansion. They are subject to the rubric and only enter `validated_kb.md` if they score ≥ 4.0/5.
- Newly discovered papers (from OpenAlex semantic search) are subject to the full rubric.

**Rubric (5-point scale, three dimensions):**

| Dimension | Weight | Criterion |
|---|---|---|
| Experimental rigor | 2 | Empirically tests AI status, AI intervention, or facilitative questioning in a small-group decision context. Pure conceptual/review papers score lower. |
| Operationalizability | 2 | Provides specific linguistic cues, dialogue protocols, or intervention timing rules that can be lifted into a prompt. |
| Recency / authority | 1 | Top-tier venue (JPSP, ASR, AMR, ISR, MIS Quarterly, CHI, CSCW, JOB) OR published 2023+. |

Papers scoring ≥ 4.0/5 are kept. Map step scores each candidate independently; Reduce step consolidates into `validated_kb.md` with one entry per paper containing `actionable_insight` (≤ 50 words) and `theory_anchors`.

**Failure modes:**
- OpenAlex API quota exceeded: fall back to cache; if cache miss, halt and surface to user.
- S2 rate limit hit (429): exponential backoff via Bottleneck; never block OpenAlex stage.
- Fewer than 8 papers pass rubric: lower threshold to 3.5 once with explicit log warning; if still under 8, halt.

### 7.2 Agent 1 — Grounder

- **Model:** `claude-sonnet-4-6`
- **Temperature:** 0.4
- **Inputs:** `validated_knowledge_base`, `config/common_framework.yaml`, `config/manipulation_checks.yaml`
- **Output:** Four linguistic checklists (Leader, Peer, XAI, ACI) as in-memory objects passed to Agent 2

**Task:** Translate theoretical mechanisms into linguistic and behavioral checklists. For each of the four dimensions, produce:
- A list of **required behaviors** ("Leader: open turns with process control language such as 'Let us address...'")
- A list of **forbidden behaviors** ("Leader: do not use hedging openers like 'just thinking aloud'")
- For each item, the citation backing it.

**For Status (Leader/Peer):** The user's experiment design Section 4.2 currently has no draft prompt. Agent 1 generates this from scratch using Berger et al. (1972), Weidmann (2025), Seeber et al. (2020), and Chen et al. (2025) as primary anchors. Flathmann et al. (2023, 2024) for tone calibration.

**For Strategy (XAI/ACI):** Section 4.1 has draft prompts. Agent 1 audits them against Miller (2019), Brodbeck et al. (2007), Ganapini et al. (2023), and Stasser & Titus (1985). Drift between draft language and theory must be surfaced as proposed edits with rationale, not silently rewritten.

### 7.3 Agent 2 — Architect

- **Model:** `claude-sonnet-4-6`
- **Temperature:** 0.4
- **Inputs:** Agent 1's checklists, `config/common_framework.yaml`
- **Output:** Drafted `ConditionSpec` for the current condition (passed into Agent 3 for evaluation, not yet written to disk)

**Task:** Compose the prompt for one specific condition by intersecting two linguistic checklists (one from Status, one from Strategy). Emit YAML matching `ConditionSpecSchema`. Each `prompt_component` carries `text`, `rationale`, `citations`, and `theory_anchor`.

**Composition discipline:**
- Status and Strategy must remain orthogonal. Leader_ACI must feel authoritative AND inquisitive (structured auditing). Peer_XAI must feel collaborative AND explanatory. Do not collapse one variable into the other.
- The CRITICAL calculation guardrail goes last in the component list with `id: critical_guardrail_99` so it has recency dominance in the rendered system prompt.
- Forbidden tokens (lint-enforced): see `config/lint_rules.yaml`. Architect must self-check before emission.

Only the Supervisor writes the final approved YAML to disk. Architect's drafts live in `AgentState` only.

### 7.4 Agent 3 — Critic

- **Model:** `claude-opus-4-7` with extended thinking enabled
- **Temperature:** 0.2
- **Inputs:** Agent 2's draft, `config/manipulation_checks.yaml`, `config/common_framework.yaml`
- **Output:** `evaluation_scores` + structured diff feedback

**Critical sub-role separation:** Agent 3 makes **two separate Anthropic API calls** per evaluation cycle:

1. **Mock Chat call (Sub-role A — Naive Simulator):**
   - System prompt frames the model as "two human teammates in a Hidden Profile decision task." It is **not told it will be scored.**
   - The candidate prompt under evaluation is rendered as the AI teammate's system prompt. The two human personas exhibit the shared-info bias documented in Stasser & Titus (1985): early turns focus on shared positives of candidates A, B, D; only reluctantly volunteer unshared information.
   - Minimum 5 turns of dialogue. Personas are seeded deterministically from `{condition}_{loop_iteration}`.

2. **Scoring call (Sub-role B — External Evaluator):**
   - System prompt frames the model as "an experimental research methodologist evaluating an AI teammate's behavior."
   - Inputs: the full mock chat transcript + the manipulation check perception items from Section 6.1 and 6.2.
   - Output: scores 1–7 on each of four sub-scales (status target, status opposite, strategy target, strategy opposite) plus a structured diff feedback object identifying which `prompt_component.id` values are responsible for any underperformance.

**Why the split:** A single-call self-evaluation creates a self-fulfilling prophecy where the model performs the role it knows it is being scored on. Splitting prevents the Critic from gaming itself.

**Pass criteria (per `config/thresholds.yaml`):**
- `status_target` ≥ 4.5 AND `status_opposite` ≤ 3.0 (clear differentiation)
- `strategy_target` ≥ 4.5 AND `strategy_opposite` ≤ 3.0
- All citations resolve to entries in `validated_kb.md`
- No banned tokens detected (orthogonality, trigger vocab, Hangul)

### 7.5 Agent 4 — Supervisor

- **Model:** `claude-sonnet-4-6`
- **Temperature:** 0.2
- **Inputs:** Critic's evaluation, current `loop_count`
- **Output:** Either (a) final YAML write to `core_prompts/{condition}_specification.yaml` and exit, or (b) routing instructions back to Agent 2

**Loop control:**
- If pass criteria met → write final YAML, log run metadata, exit condition.
- Else if `loop_count < 10` → forward Critic's diff to Agent 2 with explicit instructions on which `prompt_component.id` values to revise. Increment `loop_count`.
- Else → write `core_prompts/{condition}_specification.FAILED.yaml` with full audit log and halt for human review.

**Soft Entropy Rule:** If three consecutive Architect iterations fail to improve the lowest-scoring sub-scale by at least 0.3 points, lower the pass threshold for that sub-scale by 0.2 (one-time, logged). This prevents infinite loops while preserving the rest of the bar. Soft Entropy is logged as a warning in the final audit; the user is expected to review and either accept or rerun.

---

## 8. The Trigger–Prompt Separation Principle

This deserves its own section because misunderstanding it will corrupt the experiment.

### 8.1 What lives where

| Concern | Repository |
|---|---|
| When the AI speaks (turn count, time elapsed, silence detection) | Experiment runtime (separate repo, already built) |
| What the AI says when it speaks | This repository |
| Logging which trigger fired | Experiment runtime (`AIIntervention` collection) |
| Defining the four conditions' behavior | This repository |

### 8.2 The anchor

In `config/common_framework.yaml` under the `agent_calling_model` key, include exactly one short paragraph (1–3 sentences) telling the AI:
- It is called periodically by an external scheduler.
- Each call is a continuation of an ongoing conversation, not a new arrival.
- Pace contributions across multiple intervention opportunities; do not exhaust all knowledge in one turn.

This is the **only** acknowledgment of the trigger system. It contains no specific numbers, no trigger names, no thresholds. Numbers belong in the runtime repo and may be adjusted after pilot testing; the anchor stays stable.

### 8.3 Why the anchor is needed even though transcript is provided

Providing the transcript tells the model what was said. It does not tell the model **how the model itself is invoked**. Without the anchor:
- The model may re-greet on every turn ("Hi team, just joining...") even though prior turns show it has already been participating.
- The model has no model of its own pacing and may dump all Z-profile information in a single turn, defeating the experimental manipulation of facilitative questioning (ACI) versus contrastive explanation (XAI).
- The model may reference its own prior turns inconsistently ("As I mentioned" / "Has anyone considered" alternating randomly).

### 8.4 Lint enforcement

`tests/lint_trigger_vocab.test.ts` scans all files in `core_prompts/` for tokens from `config/lint_rules.yaml`'s `trigger_vocab_banlist`. Any match fails CI. Banlist entries are case-insensitive substring matches.

---

## 9. Build Phases

Follow these in order. Do not jump ahead. Each phase has a Done-When criterion that must be satisfied before the next phase begins.

### Phase 1 — Infrastructure and Common Framework

**Tasks:**
1. Initialize repo, `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`.
2. Install dependencies (see Section 4.1).
3. Create directory structure (Section 5).
4. Write `config/common_framework.yaml`:
   - Hidden Profile dataset (X-, Y-, Z-profiles verbatim from user's PDF).
   - Common Prompt (Section 4.4 verbatim).
   - `agent_calling_model` anchor (Section 8.2 of this CLAUDE.md).
   - `[CRITICAL SYSTEM RULE]` wrapper for the ratio calculation rule.
5. Write `config/manipulation_checks.yaml` from Section 6.1 and 6.2 verbatim.
6. Write `config/thresholds.yaml` (pass = 4.5, opposite_max = 3.0, loop_limit = 10, soft_entropy_decay = 0.2).
7. Write `config/llm_models.yaml` mapping agents to model strings (see Section 11 below).
8. Write `config/lint_rules.yaml` with three banlists: `xai_forbidden_vocab`, `aci_forbidden_vocab`, `trigger_vocab_banlist`.
9. Write `config/seed_papers.yaml` from the user's literature list (P0 + P1 + P2 + Done + Reading).
10. Implement Zod schemas in `src/schemas/`.
11. Set up Anthropic SDK client wrapper in `src/llm/anthropic.ts` with prompt caching headers.

**Done When:**
- `pnpm install` succeeds.
- `pnpm run lint` runs Hangul check, schema validation on all `config/*.yaml`, and passes.
- `pnpm test` passes (skeleton tests OK).
- `common_framework.yaml` checksum recorded in `tests/frozen_common.test.ts`.

### Phase 2 — Knowledge Base Construction

**Tasks:**
1. Implement `src/external/openalex.ts` with API key auth, Bottleneck limiter (100 req/sec safety cap), and DOI-keyed cache.
2. Implement `src/external/semanticScholar.ts` with optional API key, Bottleneck limiter (1 req/sec unauthenticated, increase if key present), and DOI-keyed cache.
3. Implement `src/external/cache.ts` (file-based, JSON, keyed by normalized DOI).
4. Implement `src/agents/agent0_scout.ts`:
   - Stage 1: Force-include P0 + Done from seeds. Search OpenAlex with keyword combinations derived from P1/P2/Reading. Enrich each candidate via S2 (TLDR + influentialCitationCount).
   - Stage 2: Map-Reduce rubric scoring (Haiku, temperature 0.0) on non-force-included candidates.
   - Output: write `knowledge_base/candidate_pool.json` and `knowledge_base/validated_kb.md`.
5. Implement `scripts/scout.ts` as standalone entry.

**Done When:**
- `pnpm run scout` produces `validated_kb.md` with at least 10 entries (force-includes + ≥4.0 scorers).
- All cache files committed to git.
- Each entry has a unique `citation_key` matching the regex in `ValidatedPaperSchema`.
- `tests/citation_resolution.test.ts` passes (every citation key is resolvable).

### Phase 3 — Four-Condition Prompt Compilation

**Tasks:**
1. Implement `src/state/agentState.ts`.
2. Implement `src/agents/agent1_grounder.ts`, `agent2_architect.ts`, `agent3_critic.ts`, `agent4_supervisor.ts`.
3. Implement `src/graph/workflow.ts` (LangGraph StateGraph with the loop edge from Supervisor → Architect).
4. Implement `scripts/build_condition.ts` (one condition) and `scripts/build_all.ts` (all four sequentially, NOT in parallel — Architect drafts share enough lessons that sequential is safer for the first pass).

**Done When:**
- `pnpm run build:all` produces four files in `core_prompts/`.
- All four pass `tests/lint_orthogonality.test.ts`, `tests/lint_trigger_vocab.test.ts`, `tests/lint_hangul.test.ts`, and `tests/schema_validation.test.ts`.
- Manipulation check scores in each YAML's `_audit` block (Supervisor-generated, optional) show `status_target ≥ 4.5` and `opposite ≤ 3.0`.

### Phase 4 — Appendix Generation and Pilot Tooling

**Tasks:**
1. Implement `scripts/generate_appendix.ts` to render `appendix/prompt_literature_mapping.md` and `.csv` from the four YAMLs + `validated_kb.md`.
2. Implement `scripts/verify_repro.ts` to compare cached snapshots against fresh API calls (warns on diffs, does not fail).
3. Document pilot procedure in `docs/pilot_protocol.md` (user-written, not Claude Code's job; placeholder file).

**Done When:**
- `pnpm run appendix` produces both files.
- CSV has columns: `condition`, `component_id`, `text`, `rationale`, `citations`, `theory_anchor`, `version`.
- Markdown is organized by condition with citation footnotes.

---

## 10. Workflow Commands

All commands assume pnpm. Add these to `package.json` scripts:

```json
{
  "scripts": {
    "scout": "tsx scripts/scout.ts",
    "build:condition": "tsx scripts/build_condition.ts",
    "build:all": "tsx scripts/build_all.ts",
    "appendix": "tsx scripts/generate_appendix.ts",
    "verify:repro": "tsx scripts/verify_repro.ts",
    "lint": "vitest run --dir tests --reporter=verbose",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Usage examples:
- `pnpm run scout` — Phase 2, build the knowledge base.
- `pnpm run build:condition leader_xai` — Phase 3, build one condition.
- `pnpm run build:all` — Phase 3, build all four conditions sequentially.
- `pnpm run appendix` — Phase 4, generate publication-ready appendix.
- `pnpm run lint` — Run all lint checks (Hangul, orthogonality, trigger vocab, schema).

---

## 11. LLM Model Configuration

`config/llm_models.yaml`:

```yaml
# Single source of truth for agent → model mapping.
# Change here only; agents read this file at startup.

agents:
  scout:
    model: "claude-haiku-4-5-20251001"
    temperature: 0.0
    max_tokens: 2000
    extended_thinking: false

  grounder:
    model: "claude-sonnet-4-6"
    temperature: 0.4
    max_tokens: 4000
    extended_thinking: false

  architect:
    model: "claude-sonnet-4-6"
    temperature: 0.4
    max_tokens: 4000
    extended_thinking: false

  critic_simulator:        # Sub-role A
    model: "claude-opus-4-7"
    temperature: 0.7        # Higher for natural dialogue variance
    max_tokens: 3000
    extended_thinking: false

  critic_evaluator:        # Sub-role B
    model: "claude-opus-4-7"
    temperature: 0.2
    max_tokens: 2000
    extended_thinking: true

  supervisor:
    model: "claude-sonnet-4-6"
    temperature: 0.2
    max_tokens: 2000
    extended_thinking: false
```

---

## 12. Prompt Caching Strategy

Anthropic's API supports prompt caching via the `cache_control: {"type": "ephemeral"}` block marker. This project benefits enormously from it because the same large context (`common_framework.yaml` + `validated_kb.md`) is reused across every Agent 2, 3, and 4 call.

**Implementation rules:**

1. Construct every system prompt with the cacheable prefix first:
   ```
   [common_framework rendered as text]
   [validated_kb compressed summary]
   <<< CACHE BREAKPOINT >>>
   [agent-specific instructions]
   [current AgentState slice]
   ```

2. In `src/llm/anthropic.ts`, wrap the cacheable prefix with `cache_control: {"type": "ephemeral"}` on the last block before the breakpoint.

3. Expected hit rate during a full Phase 3 run: ≥ 90% on the prefix across the 10–40 iterations of Critic + Architect calls. This typically reduces total Phase 3 cost by 70–85%.

4. Do not cache the `prompt_draft` itself or the `mock_chat_log`; these change every iteration.

5. Cache TTL is 5 minutes by default in Anthropic's ephemeral cache. A full Phase 3 condition build typically completes in 2–4 minutes, so this is fine. If a single condition build exceeds 5 minutes, expect cache to expire mid-loop; Anthropic re-warms automatically on the next call.

---

## 13. Reproducibility and Snapshot Policy

This is a thesis project. A reviewer or follow-up researcher must be able to reproduce the exact stimuli used in the experiment.

1. **Cache directories are committed to git.** `cache/openalex/` and `cache/s2/` are NOT in `.gitignore`. Yes, this adds repo weight; that is the price of reproducibility.

2. **YAML versioning.** Each modification to a `core_prompts/*.yaml` file bumps the version. Never edit in place without a bump.

3. **`scripts/verify_repro.ts`** can be run by reviewers to confirm that current OpenAlex / S2 API responses still match the snapshots used during prompt construction. Drift is logged but does not invalidate the original stimuli; the original cache files are authoritative for the experiment.

4. **`tests/frozen_common.test.ts`** records the SHA-256 of `config/common_framework.yaml` at the time of repo initialization. CI fails if this checksum changes without an explicit, committed checksum update. This is a Tripwire, not a lock — the user can update the checksum, but only intentionally.

---

## 14. Build Guards (the Seven Failure Modes)

These are the seven highest-risk failure modes for the pipeline and how each is defended against.

### 14.1 Citation Hallucination

**Risk:** Agent 1 or 2 fabricates a citation that does not exist in `validated_kb.md`.
**Defense:** `tests/citation_resolution.test.ts` enforces exact-string matching from every `citations` entry in every `core_prompts/*.yaml` to a `citation_key` in `knowledge_base/validated_kb.md`. Agent 3 also performs this check before scoring; a mismatch returns the draft to Agent 2 with the unresolved citation flagged.

### 14.2 Cross-Condition Contamination

**Risk:** XAI condition uses questioning vocabulary; ACI condition uses contrastive vocabulary. Result: variables no longer orthogonal, experiment invalid.
**Defense:** `config/lint_rules.yaml` defines two banlists:
- `xai_forbidden_vocab`: `["ask", "could you share", "what do you think", "any other information", "have we considered", "probe"]`
- `aci_forbidden_vocab`: `["in contrast to", "because of", "stronger than", "comparing", "the ratio", "let me explain why"]`

These are starting lists. Refine in pilot. `tests/lint_orthogonality.test.ts` enforces with **word-boundary matching** (so "task" doesn't trigger "ask"), scanning **only `component.text`** (rationale is audit metadata, not rendered).

Initial pilot refinement (2026-05-26): dropped `"elicit"` and `"open question"` from the XAI banlist. Both have legitimate non-ACI idiomatic uses — "the open question is how to weight…" means "an unresolved matter", not "an open-ended question"; "elicit" frequently appears in negation phrases like "not designed to elicit input." Behavioral orthogonality is the actual test (Critic Evaluator scoring); the surface banlist is a defense-in-depth safety net.

### 14.3 Infinite Loop

**Risk:** Critic perpetually returns near-passing scores; Architect oscillates between drafts.
**Defense:** Loop count hard cap of 10. Soft Entropy after 3 stagnant iterations. Final fallback: write `*_specification.FAILED.yaml` with audit log and halt for human review.

### 14.4 JSON / Schema Drift

**Risk:** LLM emits malformed YAML; pipeline crashes mid-loop.
**Defense:** All agent outputs use Anthropic's tool-use feature (structured output). Zod parse with `.strict()` on every state transition. On parse failure, retry once with explicit error message in user turn; on second failure, halt.

### 14.5 Mock Chat Self-Fulfilling Prophecy

**Risk:** Critic's single-call simulation-plus-scoring causes the model to perform the role it knows it is being scored on.
**Defense:** Two separate API calls (Simulator + Evaluator) with different system prompts. Simulator is told nothing about scoring. See Section 7.4.

### 14.6 Cache Invalidation Surprises

**Risk:** OpenAlex returns slightly different metadata six months later; reproducibility lost.
**Defense:** Cache files committed to git. `scripts/verify_repro.ts` for periodic checks. The cached snapshot is the source of truth for thesis stimuli, not the live API.

### 14.7 Prompt Drift on Long Context

**Risk:** As Mock Chat transcripts grow, the model loses track of the CRITICAL ratio calculation rule.
**Defense:** Place `critical_guardrail_99` last in `prompt_components` so it renders at the end of the system prompt (recency advantage). Additionally, in `agent3_critic.ts` Simulator sub-role, prepend a short reminder ("Remember to calculate the running ratio of positives to negatives for each candidate.") to the Simulator's user turn every 3rd turn.

---

## 15. What Claude Code Should NEVER Do

1. **Never modify `config/common_framework.yaml`** without explicit user approval in chat. It is the experimental control.

2. **Never generate a `prompt_component` without `citations`.** Zod will reject it, but do not even attempt it. If the theoretical grounding is missing, ask the user.

3. **Never abstract the four conditions into a shared module.** Even if the code looks duplicative. Section 3.1 explains why.

4. **Never use Korean (or any non-English language) in committed artifacts.** Korean source documents are reference inputs only.

5. **Never include trigger vocabulary in `core_prompts/*.yaml`.** The trigger system is in another repo. Section 8 explains.

6. **Never skip Critic's two-call discipline.** A merged Simulator+Evaluator call breaks the manipulation. Section 14.5 explains.

7. **Never invalidate the cache without explicit user approval.** `cache/openalex/` and `cache/s2/` are committed deliberately. Treat them as source data.

8. **Never run `pnpm run build:all` with stale `validated_kb.md`.** Re-run scout first if the knowledge base is older than the seed papers config.

9. **Never bypass the Zod schemas.** They are the contract. If a schema is wrong, propose a schema change in chat; do not silently work around it.

10. **Never auto-bump versions on YAML save.** Version bumps are intentional acts. Surface them to the user.

11. **Never call OpenAlex or Semantic Scholar without the cache check first.** Every external call goes through `src/external/cache.ts`.

12. **Never use `temperature > 0.5` in Critic Evaluator or Supervisor.** Determinism matters for reproducibility.

13. **Never write to `core_prompts/` directly from Architect.** Only Supervisor writes final files, and only after pass criteria are met.

14. **Never run agents in parallel across conditions in Phase 3.** Sequential is required for the first build. Parallelization can be considered after the pipeline is proven, but not before.

15. **Never assume model strings.** Always read from `config/llm_models.yaml`. Do not hard-code `"claude-sonnet-4-6"` in agent files.

---

## 16. Project-Specific Vocabulary

When reading or generating prompts, the following terms have precise meanings in this project. Do not paraphrase or substitute synonyms.

| Term | Meaning |
|---|---|
| **Hidden Profile** | The experimental paradigm (Stasser & Titus, 1985) in which optimal information is unevenly distributed across team members. |
| **Shared information** | Information held by all team members at the start of discussion. The four candidates' positive traits 1–3 in the user's dataset. |
| **Unshared information** | Information held by only one team member. The differentiating positive and negative attributes. |
| **Z-profile** | The information set held by the AI teammate. Specified in `common_framework.yaml`. |
| **X-profile, Y-profile** | The information sets held by the two human team members. |
| **Status (Leader / Peer)** | Independent variable 1. Operationalized via Berger et al. (1972) status characteristics theory. |
| **Strategy (XAI / ACI)** | Independent variable 2. XAI = explainable AI (causal-contrastive). ACI = AI-Centered Inquiry (facilitative questioning). |
| **Manipulation check** | A perception item (1–7 Likert) used post-experiment to verify that the manipulation registered. See `manipulation_checks.yaml`. |
| **Linguistic checklist** | Agent 1's output. A list of required/forbidden surface-language features per condition variable. |
| **Prompt component** | One YAML object with `id`, `text`, `rationale`, `citations`. The atomic unit of prompt content. |
| **Condition specification** | One complete YAML file in `core_prompts/`. The atomic unit of experimental stimulus. |

---

## 17. When to Escalate to the User

Claude Code should ask the user before proceeding when:

1. A new failure mode appears that is not covered in Section 14.
2. The user has asked for something that requires modifying `common_framework.yaml`, `manipulation_checks.yaml`, or `seed_papers.yaml`.
3. The validated knowledge base has fewer than 10 entries even after lowering the rubric threshold.
4. A condition fails all 10 loop iterations.
5. Cache hits drop below 80% in a pipeline run (suggests cache or DOI normalization bug).
6. Any test in `tests/` is being modified to make a failing build pass. Tests should describe the truth; making them pass by weakening them is a regression.

When in doubt, ask. The user is researching for a master's thesis defense; silent assumptions are more expensive than questions.

---

## 18. Source Materials Reference

The user provided these source materials during planning. They are reference inputs only; do not commit them to the repo.

- **Experiment design document** (English, Notion export): contains Sections 1–11 of the experiment protocol. Sections 4.1, 4.2, 4.4, 5, 6, 7 are the most relevant for prompt construction.
- **Hidden Profile dataset PDF** (English, 3 pages): X-profile, Y-profile, Z-profile cards. Verbatim source for `common_framework.yaml`.
- **Literature list** (Korean + English, 2 documents): seed papers organized as P0/P1/P2/Done/Reading. Source for `seed_papers.yaml`. English-language entries only; Korean annotations are translated to English during YAML construction.
- **Trigger architecture document** (Korean): describes the trigger system in the experiment runtime repo. Reference only; this repo does not implement triggers.

If the user uploads additional materials, place them in `docs/_kor_reference/` (gitignored) if Korean, or in `docs/source_materials/` if English. Either way, they are inputs, not outputs.

---

## 19. End-of-Session Checklist

Before ending a coding session, verify:

- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm run lint` passes.
- [ ] All new files have appropriate license headers if applicable (none required for this project).
- [ ] Any new external dependency has been documented in this CLAUDE.md if it materially affects the architecture.
- [ ] No `console.log` left in production paths; use `pino` logger.
- [ ] No commented-out code blocks larger than 3 lines.
- [ ] Git status shows expected files only; `.env` is not staged.

---

*End of CLAUDE.md. Last updated: 2026-05-26. This file is read at the start of every Claude Code session.*
