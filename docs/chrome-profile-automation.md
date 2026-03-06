# Codex Chrome Profile Workflow

This repo now includes a dedicated Chrome profile for Codex-driven browser work.

## Why this exists

The built-in web browsing/search tool does not share your local Chrome cookies, extensions, or logged-in accounts.
When you need the same permissions as your browser session, use the local Playwright workflow in this repo instead.

## Profile location

- Dedicated user data dir: `.local/chrome-codex-profile`
- Chrome binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

This keeps automation separate from your everyday Chrome profile.
On macOS, the login window also uses Chrome's mock keychain mode so Playwright can read the same saved session later.

## First-time setup

Open a dedicated Chrome window and log in manually:

```bash
npm run chrome:codex:login
```

Optional: open a specific site directly:

```bash
npm run chrome:codex:login -- https://mail.google.com
```

After logging in, close that Chrome window so Playwright can reuse the profile cleanly.
If you logged in before this repo added mock-keychain alignment, log in once again with the current script so the session is saved in the same storage context that Playwright uses.

## Reuse the login state

Run a quick check with Playwright:

```bash
npm run chrome:codex:check -- https://mail.google.com
```

This launches Chrome with the same dedicated profile, opens the target URL, and saves a screenshot to:

`output/playwright/codex-profile-check.png`

If the site opens in a logged-in state, the workflow is working.

## How to ask Codex later

Describe the task as a local browser automation request, for example:

- "Use the dedicated Chrome profile and open Gmail."
- "Use Playwright with the repo's Codex Chrome profile and inspect this page."
- "Do not use built-in web browsing; use the local logged-in Chrome workflow."

## Important constraints

- Do not keep the dedicated Chrome window open while Playwright is trying to use the same profile.
- Do not point automation at your everyday Chrome `Default` profile.
- Treat this dedicated profile as sensitive because it contains logged-in sessions.
