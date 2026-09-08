# 22: Alex keeps the information only Alex has

**What to fix:** Alex disclosed one of the eight traits no human holds, and spent
seven of its nine disclosures on traits everyone could already see. The measure
this study exists to take is what each participant contributes to the pool, and
in T-C2-047 Alex's contribution was one trait.

**Status:** needs-triage

## What was observed

T-C2-047, Chair + explanatory, verified build 1.9.0, 13 Alex messages.

Alex holds 24 traits. Sixteen of them are on every participant's card. **Eight
are held by nobody else**, and those eight are Alex's entire possible
contribution to the pool:

| | Alex alone holds | disclosed |
| --- | --- | --- |
| A | `A_n5`, `A_n6` — both misses | no |
| B | `B_n5`, `B_n6` — both misses | no |
| C | `C_p6`, `C_p7` — both matches | `C_p7` only |
| D | `D_n5`, `D_n6` — both misses | no |

The group chose B. Alex held both of B's unique misses and said neither. The
group eliminated C at seq 2 and never revisited it. Alex held one of C's unique
matches and said neither of the two it had until seq 11, then stopped.

Of the nine traits Alex did surface, seven are shared traits: `B_p1`, `B_n4`,
`C_p1`, `D_p1`, `A_p2`, `A_p3`, `A_p4`, `B_p3`. Disclosing a shared trait adds
nothing to the pool by construction — every participant already had it.

## The two statements that close the door

At seq 15, asked for new insight: *"I have no new facts beyond what's already on
the table."* Seven unshared traits were in its notes.

At seq 36, asked directly whether it held information the others did not:
*"...they match being very well organized... they match assessing weather
conditions very well. Those are the only new facts I have."* Both named traits
are shared, one of them was arguably already on the board, and seven unshared
traits were still unsaid.

The second is the worst case available in this task: a participant asked the
pooling question in plain words and was told no.

## What is probably causing it, and what must not be done about it

Every trait-bearing turn in this session carried `maxTraitIds: 1`. Over thirteen
messages that is a ceiling of thirteen traits, and the session used far less than
that because most turns spent their budget on a shared trait or on none.

**Raising the budget is not the fix, and may not be applied as one without
discussion.** Message length and information volume are covariates in the
analysis, and the Chair conditions already carry procedural speech the Member
conditions do not. A budget that differs, or that rises far enough to change
message length, changes the manipulation.

The question this issue has to answer first is *why the model spends its one
disclosure on a trait everybody already has*, not *how many disclosures it gets*.
Alex knows which of its traits have been surfaced — `previouslySurfacedTraitIds`
is built for every turn — but nothing tells it which of its traits **no one else
can have**. That distinction is available deterministically from the profile
data and is not currently in front of the model.

## What must not regress

- No condition may receive a different reveal budget from another
- Alex may not state or imply which profile a trait came from — that is not
  something a participant can know about their own card
- The pooling DV counts first surfacing, so a fix that increases restatement
  instead of disclosure is not a fix

- [ ] A count, per session, of unshared traits Alex held versus disclosed, on the record
- [ ] Alex does not assert it has nothing further while holding an unshared trait
- [ ] A disclosure turn prefers an unshared trait over a shared one, with the preference recorded
- [ ] Message length and traits-per-message do not differ by condition after the change
