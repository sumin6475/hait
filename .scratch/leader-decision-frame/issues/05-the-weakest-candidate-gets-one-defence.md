# 05: The weakest candidate gets one defence, and it brings nothing new

**What to build:** Once per session, after the list has narrowed and before the
close, the leader re-argues the weakest live candidate from what is already on
the board.

**Blocked by:** 04.

**Status:** needs-triage

## This is a treatment, and it is being declared as one

Naming a candidate the group skipped is discussion management. Deliberately
arguing for the option the group has moved away from is **confirmation-bias
correction** — a debiasing intervention studied in its own right. Granting it to
the Chair conditions means the Chair condition is "a higher-status AI **that also
runs a debiasing step**", and any accuracy difference is attributable to either.

That is acceptable if, and only if, it is declared: the re-argument is part of
the definition of Chair status in this study, not an incidental feature of the
implementation. Pre-registration must say so. If it cannot say so, this issue
does not ship and the design stops at issue 04.

## The constraint that keeps it procedural

**The defence introduces no new trait.** It re-argues from what is already on the
board. Without this, the Chair conditions also release more information than the
Member conditions, and the manipulation is no longer status alone — it is status
plus information volume, on the very DV that measures information.

Once per session. After narrowing, before the close.

## What must not regress

- `newTraitIds` for this turn is empty; a non-empty one fails the turn
- Exactly one occurrence per session, recorded whether or not it fired
- The group may ignore it entirely; Alex accepts and proceeds to close
- No peer condition has any path to it

- [ ] The defence turn introduces zero new traits, enforced not requested
- [ ] It fires at most once, and the record shows when it did not fire
- [ ] Pre-registration language naming it as part of Chair status exists before any session runs with it enabled
- [ ] Ignoring it leads to a normal close
