# 15: A trait the matcher defers and the verifier declines leaves no trace

**What to build:** The record of what the group put on the table matches what the
group put on the table. Today two traits were said aloud, twice between them, and
appear in no record at all.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## The defect, as observed

**T-C2-045.** The operator asked whether the board really held only three matches
and three misses for the finalists. It did not.

| candidate | recorded | actually on the table | missing |
| --- | --- | --- | --- |
| A | 3 matches / 3 misses | 3 / **4** | `A_n1` |
| B | 3 matches / 3 misses | 3 / **4** | `B_n3` |

Both went the same way: the deterministic matcher **deferred** to bounded
verification, and the verifier **declined**. Nothing else was watching, so the
trait left no trace — not in `sharedInfoIds`, not in `revealStats`, not in the
count Alex read back to the group at seq 47.

**`B_n3`, seq 33.** A participant wrote the trait in quotation marks. Quoted
evidence trips `hasAmbiguousAssertionContext`, which exists to stop reported
speech — *"They said Candidate B is 'considered arrogant'"* — from surfacing a
trait. But there was no reporting verb here. A participant quoting a phrase off
their own card is disclosing it, and the rule cannot tell the two apart because
it looks only at the quote marks.

**`A_n1`, seq 35 and 36.** At seq 35 a participant raised it inside a
hypothetical question, and deferring there is right. At **seq 36 Alex asserted it
flatly** — "A not tolerating criticism … two confirmed misses for A" — and it was
deferred again, because the registry holds "not tolerate criticism" and Alex
wrote "not toleratING criticism". A near-match, so verification, so nothing.

## Why this is worse than it looks

`sharedInfoIds` is not diagnostic output. It is:

- **the pooling DV**, the study's dependent variable;
- **the evidence handed to the reveal guard** — `disclosedTraitIds` reads
  `acceptedIds` and discards the verification candidates, so a deferred trait is
  a reveal no budget can count;
- **the input to the anti-repeat work** (issue 04) — a trait Alex said but that
  was never recorded is one Alex may say again as if new;
- **the set a count request reports** (issue 14) — fixing that issue's source
  bug still yields 3/3 here, because the set itself is short.

Issue 11 named this shape and pinned four registry phrases against it. This is
the same failure arriving from the other side: not a phrase the registry lacks,
but the **deferral path failing open**.

## The change

Two independent corrections; both are needed and either can ship alone.

**A. A quotation is not automatically reported speech.** Require a reporting verb
or attribution nearby before quote marks suppress a match. A participant quoting
a pool phrase with no "they said" attached is asserting it.

**B. Correct the keyword list**, as issue 11's rule allows: an audit finding is a
correction to the keyword list, never a new trait. `A_n1` needs its ordinary
inflection. Check every entry for the same gap rather than patching one — Alex's
output contract requires it to preserve a trait's key wording, and it inflected
anyway.

**Also decide, and record, what happens when the verifier declines.** Right now
that is silent and terminal. At minimum a declined candidate should be
recoverable from the record; today the only way to learn it happened is to
re-run the matcher over an export by hand, which is how this was found.

## What must not regress

- **Reported speech, questions and hypotheticals still surface nothing.** The
  existing assertions for each stay, unedited — `'They said Candidate B is
  "considered arrogant"'` must keep returning nothing, and it has a reporting
  verb, so A does not touch it
- The pool stays 40 traits. A keyword correction is not a new trait
- Matching stays deterministic and network-free on the accept path
- No participant text enters any tracked artifact

- [ ] The seq 33 quotation records `B_n3`
- [ ] The seq 36 assertion records `A_n1`
- [ ] The seq 35 hypothetical still records nothing
- [ ] The reported-speech, question and hypothetical assertions pass unedited
- [ ] Every registry entry is checked for the inflection gap, not just `A_n1`
- [ ] A declined verification is visible in the record, or the decision not to
      record it is written down with its reason
