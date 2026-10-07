# prot

Guided pull request reviews on your Mac. prot lists the PRs waiting on you, badges the Dock with the count, and walks each PR as a story: where the change enters, the code it calls, the data it uses, and the tests that cover it.

## Install

You need macOS, [Node.js](https://nodejs.org) 22 or newer, and git. The [GitHub CLI](https://cli.github.com) is optional and makes sign-in one click.

```bash
git clone https://github.com/ethan-mcq/prot.git
```

```bash
cd prot
```

```bash
npm install
```

```bash
npm run install-app
```

This builds `prot.app` and moves it to `~/Applications`. Open it from there and drag it to the Dock to keep it.

To update later, pull and install again:

```bash
git pull && npm install && npm run install-app
```

## First run

1. **Sign in.** Click "Continue with GitHub CLI" if you use `gh`, or paste a personal access token with `repo` scope.
2. **Add an Anthropic key (optional).** Click the cat button at the bottom right and paste a key. It turns on the AI guide and chat. Without a key you still get the code-derived guide.

Tokens and keys are encrypted with the macOS keychain and never leave your machine except to GitHub and Anthropic.

## Develop

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run test:e2e
```

E2E drives the real app, with its window hidden, against fixture GitHub and Anthropic servers in `tests/fixtures`. Set `PROT_HEADED=1` to watch it. `GITHUB_API_URL` points prot at GitHub Enterprise or a fixture server. The review model is described in `docs/storyline.md`.
