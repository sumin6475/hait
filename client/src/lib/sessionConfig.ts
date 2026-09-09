// The server closes the session on this same length. `test:intervention-v2`
// reads this file and fails if the two disagree — the two packages are separate
// npm installs, so neither can import the other.
// Server side: server/src/config/triggers.ts DISCUSSION_DURATION_MS
export const DISCUSSION_DURATION_MINUTES = 30;
export const MIN_DISCUSSION_MINUTES = 12;
