# Agent dash

One place to start, watch and steer coding agents on both subscriptions the user is signed into: Claude Code (claude.ai login) and Codex (ChatGPT login).

## How it runs agents

prot never reads or forwards subscription credentials. It runs the official CLIs that are already installed and signed in, one process per turn:

| | Claude Code | Codex |
|---|---|---|
| Binary | `PROT_CLAUDE_BIN`, else `claude` on the login-shell PATH, else `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude` | `PROT_CODEX_BIN`, else `codex` on the login-shell PATH, else `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, `/Applications/Codex.app/Contents/Resources/codex` |
| Sign-in check | `claude auth status` (JSON: `loggedIn`, `authMethod`) | `codex login status` ("Logged in using ChatGPT") |
| First turn | `claude -p --output-format stream-json --verbose --model M --effort E --permission-mode P --session-id <uuid> -- <prompt>` | `codex exec --json -m M -c model_reasoning_effort="E" <permission flags> -C <cwd> --skip-git-repo-check -- <prompt>` |
| Follow-up | same with `--resume <session id>` instead of `--session-id` | same options, then `resume <thread id> -- <prompt>` |
| Continue an outside session | `--resume <id> --fork-session` (the original stays untouched; the new id comes from the `init` line) | same options, then `fork <id> -- <prompt>` |
| Stop | SIGINT, then SIGTERM after 5 s | same |

The prompt always follows `--`, so a prompt starting with `-` is not read as an option. `codex exec resume` and `fork` reject `-s`, `-C` and `--approve-for-me` after the subcommand, so every Codex option goes before it. Each turn's stdin is `/dev/null`, except a Claude turn with attached images (see Attachments).

Children run with the login shell's PATH (resolved once, `$SHELL -ilc 'printf %s "$PATH"'`), so agents find git, gh, node and the rest the same way the desktop apps do. Each child runs in its own process group and signals go to the group, so the commands an agent started stop with it. All children get SIGTERM when prot quits; agents that were running are marked `stopped` on the next launch. A turn that exits non-zero without a result is `failed`, with the last stderr lines as an error event.

### Permissions

| Claude id | Meaning | Codex id | Flags |
|---|---|---|---|
| `auto` (default) | Claude Code auto mode: a classifier approves safe actions | `auto` (default) | `--approve-for-me` |
| `acceptEdits` | Edits allowed; commands that need approval are denied | `workspace-write` | `-s workspace-write` |
| `plan` | Read-only, proposes a plan | `read-only` | `-s read-only` |
| `bypassPermissions` | No checks | `full` | `--dangerously-bypass-approvals-and-sandbox` |

### Models and defaults

- Claude: Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`); efforts low, medium, high, xhigh, max. The default model and effort come from `$CLAUDE_CONFIG_DIR/settings.json` (`model`, `effortLevel`) when set, else Opus 5.5 at high. A settings model that is an alias, such as `opus[1m]`, is offered as-is at the top of the list.
- Codex: the `visibility: "list"` entries of `$CODEX_HOME/models_cache.json`, by `priority`, with their `supported_reasoning_levels`. The default comes from the top-level `model` and `model_reasoning_effort` of `$CODEX_HOME/config.toml`.

## Folders

An agent starts in any folder. A folder inside a git repo is stored as the repo root; any other folder is used as-is. In a folder that is not a git repo the agent runs in the folder itself (`branch` null, no worktree: the composer's checkout picker is disabled with a hint), and the git-only parts stay empty: no changes panel entries, no PR lookup. Codex already runs with `--skip-git-repo-check`. The composer's "Folder" picker lists recent folders (`agents.json` `repos`, newest 20) and "Add folder…" opens a folder dialog.

## Worktrees

With "New worktree" on (git folders only), prot runs `git -C <repo> worktree add -b prot/<slug> ~/.prot/worktrees/<repo name>/<slug> HEAD` before the first turn (`PROT_WORKTREE_ROOT` replaces `~/.prot/worktrees`, for tests). `<slug>` is the first words of the prompt plus a short random suffix. The base is the repo's current branch. Removing a worktree runs `git worktree remove --force` and leaves the branch; prot only removes worktrees under its own root.

## Skills and commands (`/`)

Typing `/` in the task or follow-up box opens a listbox of commands and skills (filter as you type, ↑↓, Enter or Tab inserts, Esc closes). The agent's own CLI comes first, then the skills folder's own, then the other CLI's, which are tagged "via SKILL.md". `agents.commands(folder)` discovers them (`src/main/agents/commands.ts`):

- Claude: `.claude/skills/*/SKILL.md` and `.claude/commands/**/*.md` in the folder and each ancestor up to `$HOME`, `$CLAUDE_CONFIG_DIR/skills` and `commands`, synced skills, enabled plugins' `skills` and `commands` (namespaced `plugin:name`), the skills folder's `.claude/skills` (loaded through `--add-dir`), `/compact`, and the newest `system/commands_changed` list a Claude turn reported for that folder (cached in `agents.json`). Interactive commands that do nothing headless (`/clear`, `/model`, `/config`, `/login`, …) are left out.
- Codex: `.agents/skills` and `.codex/skills` in the folder and its ancestors, `$CODEX_HOME/skills` (3 levels, `.system` included), enabled plugins' skills, `$CODEX_HOME/prompts/*.md` as `prompts:<name>`.
- The skills folder (`settings.agentFolder`): `skills/*/SKILL.md`, `commands/**/*.md` and `.claude/commands/**/*.md`, which neither CLI loads on its own.

Name and description come from the frontmatter, else the file name and first line. On send (`expandCommands`, `src/shared/agent-commands.ts`), a `/name` the agent's CLI loads stays `/name` for Claude at the start of the prompt (elsewhere it becomes "Use the name skill."), becomes `$name` for a Codex skill, and a Codex custom prompt is inlined with `$ARGUMENTS` / `$1..$9` from the rest of the line. Any other known `/name` becomes "Read and follow the skill at <path>.". Unknown `/words` are left alone. The transcript keeps what was typed; only the CLI sees the expanded text.

## Context

`AgentSummary.context` is `{ usedTokens, windowTokens }` or null, shown as a ring at the bottom right of the follow-up box (amber from 70 %, red from 90 %, tooltip "250k / 1M tokens (25%)").

- Claude: used is input + cache read + cache creation + output tokens of the newest assistant message's `usage`; the window is `result.modelUsage[model].contextWindow`, remembered per model in `agents.json`, else 200k (1M for `[1m]` models).
- Codex: the newest `token_count` in the thread's rollout file, read after each turn: `info.last_token_usage.total_tokens` of `info.model_context_window`.
- Outside sessions: the same, from their files.

## Attachments

The paperclip, paste and drag-drop in either box copy files to `userData/agents/attachments/<random>/<name>` (20 MB each, at most 20 per message, name sanitized). A send only accepts attachments that resolve to files under that folder. Images (png, jpeg, gif, webp) go natively: Claude runs with `--input-format stream-json` and prot writes one user message on stdin (a text block, then a base64 image block per image) and closes it; Codex gets `--image=<path>` per image (before the thread id on `resume` / `fork`). Other files are listed in the prompt as "Attached files:" with their paths. The user event keeps the attachments and shows image thumbnails.

## Images back

Images in Claude `tool_result` blocks are written to `userData/agents/images/<sha256>.<ext>` and attached to the tool event's `images`; absolute paths of existing image files in assistant text or tool output (markdown images or bare paths) are attached too, as are Codex `ImageView` / `ImageGeneration` items from rollouts. They render as thumbnails under the text or the run of tool calls (click to enlarge), and markdown images of those paths render inline. The renderer loads them through `prot-agent-file://f/<encoded path>`, which main serves only for image files (by extension and magic bytes) whose paths appeared in an event or attachment it loaded; everything else is a 404.

## Events

Both CLIs' JSON lines are mapped into `AgentEvent`s (`src/shared/agents.ts`):

- Claude `assistant` content blocks: `text` → assistant, `thinking` → thinking, `tool_use` → tool (running); `user` `tool_result` → completes the matching tool; `result` → turn (duration, cost, input tokens including cache reads and writes, output tokens), plus an error event when `is_error`; `rate_limit_event` → usage windows (`unifiedWindows.five_hour` / `seven_day`; `utilization` is a fraction, shown as a percent). stream-json repeats a message id once per content block, so text and thinking are keyed by message id and block, tools by `tool_use` id, and a repeated block or result adds nothing.
- Codex `item.started` / `item.completed` by `item.type`: `agent_message` → assistant, `reasoning` → thinking, `command_execution` / `file_change` / `mcp_tool_call` / `web_search` → tool, `error` → error (config warnings are dropped); `turn.completed` → turn (duration measured from `turn.started`, no cost); `turn.failed` → error. `codex exec` numbers items from `item_0` in every process, so event ids get a per-turn prefix. Usage comes from the newest `rate_limits` (`primary` / `secondary`: `used_percent`, `window_minutes` as "5 hour" / "7 day", `resets_at`) in `$CODEX_HOME/sessions` `token_count` events.

Events are upserts keyed by `id`: a tool is sent when it starts and again, same id, when it completes. Usage `resetsAt` is epoch seconds. Archived agents are left out of the state and never broadcast; archiving keeps the worktree and branch.

Transcripts are stored as JSONL at `userData/agents/<id>.jsonl`, one line per event version, read back as the latest version of each id; the agent list, recent repos, archived outside sessions and the last usage per provider are `userData/agents.json`.

## Sessions from the apps

Sessions started by Claude Desktop, Claude Code, the Codex app or the Codex CLI are listed read-only, so every agent is in one list:

- Claude: `$CLAUDE_CONFIG_DIR/projects/*/*.jsonl` (default `~/.claude`), modified in the last 7 days, newest 40. Title: the newest `custom-title`, else `ai-title`, else the first prompt the person typed (`origin.kind: "human"` where present; meta, sidechain, tool-result, task-notification and compact-summary lines are skipped). Cost from the newest `cost-state`.
- Codex: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` (default `~/.codex`), same window and cap, titles from `session_index.jsonl`. Only top-level threads are listed: subagent and approval-review ("guardian") threads have an object `session_meta.source` and are skipped. Current rollouts log every item as `event_msg` `item_completed` (`UserMessage`, `AgentMessage`, `Reasoning` with `summary_text`, `CommandExecution`, `FileChange`, `McpToolCall`, `Extension` web search, `ImageView`) and those are the transcript; older rollouts without them use `event_msg` `user_message` / `agent_message` / `agent_reasoning` and `response_item` `function_call` / `custom_tool_call` (+ `_output`). Developer messages and injected context are never shown. `task_complete` → turn.

Summaries read only the head and the last 256 KB of each file and are cached by mtime and size; a transcript is parsed in full when opened (last 2000 events).

A session is `running` when its file changed in the last 90 seconds, else `idle`; `turnStartedAt` is its newest prompt (Claude) or `task_started` (Codex) while running. Sessions prot itself started are not listed twice. Sending a message to one forks it into a new prot agent whose transcript starts with the original's. Archiving one hides it from the dash.

## Git and pull requests

For each agent with a cwd, prot reads the branch, and the change stat against the merge base with the worktree base (or the upstream default branch). It also reads untracked files. It refreshes after every turn and every 30 s while a prot window is focused, for non-archived agents updated in the last 24 hours. When the user is signed in to GitHub and `origin` points at github.com, the branch's PR (any state, `GET /repos/{o}/{r}/pulls?head={o}:{branch}&state=all`) is looked up at most once per 2 minutes per branch and shown on the card; `main`, `master` and the base branch are not looked up. Opening it goes to PR Review.
