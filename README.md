# prot

Guided pull request reviews on your Mac. prot lists the PRs waiting on you, badges the Dock with the count, and walks each PR as Overview, Flow, then chapters ordered core change first and tests, schema, lockfiles last.

## Run

```bash
npm install
npm run install-app
```

This builds `prot.app` and copies it to `~/Applications`. Drag it to the Dock to keep it there.

For development, run `npm run dev`.

## Sign in

Use "Continue with GitHub CLI" (reads `gh auth token`) or paste a personal access token with `repo` scope. Tokens and API keys are encrypted with the macOS keychain via Electron `safeStorage`.

## AI

Open the 👀 button at the bottom right and add an Anthropic API key. That enables the chat, which sees the PR, step, chapter, open file, visible lines and selected text. It also enables the AI guide, which replaces the instant heuristic guide and is cached per head commit.

## Tests

```bash
npm test
npm run test:e2e
```

E2E drives the real Electron app against fixture GitHub and Anthropic servers in `tests/fixtures`. `GITHUB_API_URL` points prot at GitHub Enterprise or a fixture server.
