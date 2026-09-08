# HAIT

A three-participant group task in which two people and an AI participant choose
the best of four candidates for a job. The information needed to choose correctly
is split across the three of them, so the interesting behaviour is conversational:
who says what, when, and whether the group ever assembles the whole picture.

This is the project's vocabulary. It is a glossary and nothing else — no
decisions, no status, no design. Where two words compete for one idea, the one
listed is the one to use.

## Language

### The task

**Candidate**:
One of the four people the group is choosing between, named A, B, C and D. Those
four letters name candidates and nothing else — never a participant, and never
the AI.
_Avoid_: option, applicant, choice

**Trait**:
One statement about one candidate, counting either for or against them. Forty
exist and the set never grows; every trait a participant can hold is one of them.
_Avoid_: attribute, item, point, fact

**Match / Miss**:
A trait that counts for a candidate, or against. Every match and every miss
weighs the same — the task has no quality that outranks another, and treating one
as decisive is an error the group can make.
_Avoid_: pro/con, positive/negative, strength/weakness

**Profile**:
The subset of the forty traits one participant can see — their card. Three exist,
called X, Y and Z, and every participant is dealt exactly one.

**Hidden profile**:
The task's design, in which no single profile contains enough to identify the
best candidate. The group can only get it right by pooling, which is what makes
the conversation, rather than any individual's judgement, the thing under study.

**Pooled answer**:
The candidate the group should choose once every profile's traits are in view. It
is deliberately not the candidate any single profile favours, and it is not
recorded here — Alex must reach it the way a participant would.

**Alex**:
The AI participant. It is dealt profile Z, and it is a participant with a name,
not a tool the humans operate.
_Avoid_: the bot, the assistant, the agent, the AI

### What is in view

**Surfaced**:
A trait that has been said aloud by anyone, Alex included. Its only legitimate
use is avoiding repetition — it says a thing was mentioned, not that the group
took it up.

**Confirmed**:
A trait a human participant put in view. This is the group's shared knowledge,
and it is the set to reason from when asking what the group actually knows.

**Known**:
Everything Alex may legitimately draw on: its own profile, plus everything
surfaced or confirmed. Wider than what Alex was dealt, narrower than the full
forty.

**Board**:
What the group has collectively put in view, candidate by candidate. Participants
say "on the table" and mean this; the word table means a layout everywhere else,
so prefer board when writing.

### The conversation

**Thread**:
A stretch of conversation pursuing one goal with one requested action. A session
usually has one, and a new one begins when the group changes what it is trying to
do.

**Opportunity**:
A specific opening for Alex to speak, derived from something a participant said.
It is a candidate for speech and never an entitlement — most are never taken.
_Avoid_: obligation, cue, trigger

**Kind**:
What sort of opening an opportunity is: a direct question, an invitation, a
request to the group, or an uptake of something Alex just said.

**Expectation**:
How strongly an opportunity calls for an answer: required, invited, or optional.
A direct question is the only thing that makes an answer required.

**Consumed**:
What an opportunity becomes when Alex successfully broadcasts a message answering
it. A successful broadcast is the only thing that consumes one — a failed
generation, a blocked floor, or a cancelled turn all leave it open.

**Superseded**:
What an opportunity or a turn becomes when a newer message overtakes it before it
was answered. Distinct from Alex choosing not to answer, and distinct from
failure.

**Expired**:
What an opportunity becomes when it has been open too long without being taken.
Direct questions and required expectations never expire.

**Floor**:
Who the conversation expects to speak next. It is open when nobody in particular
is expected.

**Human floor**:
A floor held by a named human, which Alex must not take. Silence while it is held
is Alex waiting its turn, never Alex having nothing to say.

**Cooldown**:
A minimum number of human messages between Alex's turns, counted deterministically
from the transcript. Silence caused by it is a pacing decision, not a judgement
about content.

**Salience**:
The most recent message at which each candidate was named, kept for the thread.
This is what ranks a candidate's claim on Alex's attention, because it is
deterministic and always defined.

**Focus**:
The single candidate the Observer judges the conversation to be about. It is
absent exactly when it would matter most — a comparison names two candidates and
a continuation names none — so it is a hint, never a ranking.
_Avoid_: using focus where salience is meant

**Seq**:
A message's position in the session, counting from the first. Every claim about
evidence names the seqs it rests on.

### The turn

**Observer**:
The stage that reads the newest human message and reports what it sees about
addressees, threading, the floor, and Alex's relation to what was said. It
proposes; it never decides.

**Ledger**:
The deterministic reducer that owns threads, opportunities and the floor. It is
the authority on conversational state, and it accepts or rejects what the Observer
proposes.

**Judge**:
The stage that decides whether Alex speaks this turn, and on what grounds.

**Router**:
The stage that applies deterministic vetoes — cooldown, the floor, lifecycle —
after the Judge has decided. A veto here is why Alex can be silent on a turn it
judged worth speaking on.

**Route**:
The shape of a turn: answering someone, following up, building on the discussion,
mediating, greeting, summarising, closing, filling a long silence, or
backchannelling. The route decides what kind of move Alex makes, not what it says.

**Broadcast**:
Sending Alex's message to the room. It is the moment a turn becomes real, and
several rules key on it rather than on generation succeeding.

### What Alex may say

**Request scope**:
How much a participant asked for — one trait, one candidate's complete list, the
whole board, a preference, a count. Read from the message itself.
_Avoid_: bare "scope", which is ambiguous between this and the reveal budget

**Reveal budget**:
How many traits Alex may introduce, and how many already-said ones it may repeat,
in a single message. A property of the turn, set by the request scope.
_Avoid_: bare "scope"

**Output scope guard**:
The limit checked against what was generated, before it is broadcast. It fails
closed: a message over budget costs the turn rather than going out oversized.

### The manipulation

**Condition**:
One of the four assignments participants are randomised to, crossing Alex's status
with how it explains itself. A fifth, control, has no AI participant.

**Peer / Leader**:
Alex's status within the group. A Leader may structure the discussion, set the
agenda, and mediate; a Peer contributes as an equal and does none of those.

**Condition orthogonality**:
The property that conditions differ only in what is being manipulated, and in
nothing else. It is the one thing every change must preserve — a Peer that gains
a Leader's behaviour makes the comparison meaningless, whatever else improves.
