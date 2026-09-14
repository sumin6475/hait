# 01: The admin token ships in the client bundle, and the dashboard has no door

**What to build:** The researcher dashboard asks for the admin token instead of
being built with it. The server's check does not change.

**Blocked by:** None. Rotate the token first (below); that step is the owner's.

**Status:** ready-for-agent

## The defect, as observed

Found 2026-09-14 while setting up the Vercel (client) and Railway (server)
deploys of `sumin6475/hait-turn-taking`.

- **The token is in the JavaScript every visitor downloads.**
  `client/src/lib/api.ts:13` reads `import.meta.env.VITE_ADMIN_TOKEN`, and Vite
  writes every `VITE_` value into the built files. Vercel says so on the variable
  itself: public prefixes expose values to the browser. Marking the variable
  secret in Vercel hides it in Vercel's own screens only.
- **`/dashboard` has no door.** `client/src/App.tsx:60` mounts the dashboard
  routes directly, `DashboardLayout` checks nothing, and `adminFetch`
  (`client/src/lib/api.ts:113`) attaches the token to every request. Opening the
  URL is enough; nobody has to find the token.
- **The token in use locally is the example value.** `server/.env.example` and
  `client/.env.example` both carry it, and both files are in two public
  repositories. If Railway was given the local value, the token is public
  whatever the bundle does.

What the token unlocks, all behind `requireAdmin`: listing and reading sessions,
exporting a session with its messages and AI records, creating and deleting
sessions, approving gates and stopping the AI (`server/src/routes/sessions.ts`),
and test-chat, which spends model calls (`server/src/routes/conditions.ts`).

## Do first (owner, no code)

Generate a new value with `openssl rand -hex 24`, set it as `ADMIN_TOKEN` on
Railway and `VITE_ADMIN_TOKEN` on Vercel, redeploy both, and put the same value
in the local `server/.env` and `client/.env`. This closes only the
public-example-value hole; the bundle and the missing door remain.

## What to build

- `adminFetch` reads the token from `sessionStorage`, not from the build.
  `VITE_ADMIN_TOKEN` leaves the client code, `client/.env.example` and Vercel.
- `DashboardLayout` asks for the token when none is stored and keeps it for the
  browser session only. A 401 from an admin route clears it and asks again.
- `server/.env.example` carries a placeholder that is plainly not a token.

## What must not regress

- The participant flow never needs the token. Checked 2026-09-14: the admin
  calls are made only from `pages/dashboard/` and the `useSessions` and
  `useConditions` hooks; nothing under `pages/chat/` calls one.
- The server still rejects a request without the right `x-admin-token`.

## Acceptance

- [ ] The built client contains no admin token (search the `dist` output)
- [ ] `/dashboard` shows only the token prompt until a valid token is entered
- [ ] A wrong token brings the prompt back rather than an empty dashboard
- [ ] A participant session runs start to finish with no token in the browser
- [ ] The token on Railway is not the value that was in the example files
