#!/usr/bin/env node
// Stands in for the codex CLI in tests: logs its argv, then streams a short `exec --json` turn.
// A prompt containing WAIT blocks until SIGINT (logged); FAIL exits 1 with stderr and no turn.completed.
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)

if (args.includes('--version')) {
  console.log('codex-cli 9.9.9')
  process.exit(0)
}
if (args[0] === 'login' && args[1] === 'status') {
  console.error('Logged in using ChatGPT')
  process.exit(0)
}

if (process.env.PROT_FAKE_ARGV_LOG) {
  appendFileSync(process.env.PROT_FAKE_ARGV_LOG, `${JSON.stringify({ bin: 'codex', argv: args, cwd: process.cwd() })}\n`)
}

const dash = args.indexOf('--')
const prompt = dash === -1 ? args[args.length - 1] : args.slice(dash + 1).join(' ')
const before = dash === -1 ? args : args.slice(0, dash)
let threadId = randomUUID()
const resume = before.indexOf('resume')
if (resume !== -1) threadId = before[resume + 1]
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`)

// Like the real CLI, log the thread under $CODEX_HOME/sessions; prot reads rate limits from there.
function record(lines) {
  if (!process.env.CODEX_HOME) return
  const now = new Date()
  const day = [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')]
  const dir = join(process.env.CODEX_HOME, 'sessions', ...day)
  mkdirSync(dir, { recursive: true })
  let text = ''
  for (const line of lines) text += `${JSON.stringify({ timestamp: now.toISOString(), ...line })}\n`
  appendFileSync(join(dir, `rollout-${now.toISOString().slice(0, 19).replace(/:/g, '-')}-${threadId}.jsonl`), text)
}

let interrupted = false
process.on('SIGINT', () => {
  interrupted = true
  if (process.env.PROT_FAKE_ARGV_LOG) appendFileSync(process.env.PROT_FAKE_ARGV_LOG, `${JSON.stringify({ bin: 'codex', signal: 'SIGINT' })}\n`)
  process.exit(130)
})

process.stderr.write('Reading additional input from stdin...\n')
emit({ type: 'thread.started', thread_id: threadId })
emit({ type: 'turn.started' })
await sleep(40)

if (prompt.includes('FAIL')) {
  process.stderr.write('Error: fake-codex: something went wrong\n')
  process.exit(1)
}

const command = "/bin/zsh -lc 'echo hi'"
emit({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command, aggregated_output: '', exit_code: null, status: 'in_progress' } })
await sleep(40)

if (prompt.includes('WAIT')) {
  while (!interrupted) await sleep(100)
}

emit({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command, aggregated_output: 'hi\n', exit_code: 0, status: 'completed' } })
await sleep(40)
const reply = `Echo: ${prompt}`
emit({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: reply } })
record([
  { type: 'session_meta', payload: { id: threadId, session_id: threadId, cwd: process.cwd(), source: 'exec', originator: 'codex_exec' } },
  { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: randomUUID(), content: [{ type: 'text', text: prompt }] } } },
  { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: randomUUID(), content: [{ type: 'Text', text: reply }] } } },
  {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { total_tokens: 64000 }, model_context_window: 256000 },
      rate_limits: {
        primary: { used_percent: 12.0, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600 },
        secondary: { used_percent: 40.0, window_minutes: 10080, resets_at: Math.floor(Date.now() / 1000) + 86400 }
      }
    }
  }
])
await sleep(20)
emit({ type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 30 } })
