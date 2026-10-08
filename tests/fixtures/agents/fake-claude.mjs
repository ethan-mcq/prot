#!/usr/bin/env node
// Stands in for the claude CLI in tests: logs its argv, then streams a short stream-json turn.
// A prompt containing WAIT blocks until SIGINT (logged); FAIL exits 1 with stderr and no result.
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)

if (args.includes('--version')) {
  console.log('9.9.9 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }))
  process.exit(0)
}

if (args.includes('/usage')) {
  const result = 'You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 31% used · resets Oct 8 at 12:19am (America/Los_Angeles)\nCurrent week (all models): 64% used · resets Oct 12 at 6:59am (America/Los_Angeles)\n'
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 0, result, total_cost_usd: 0 }))
  process.exit(0)
}

if (process.env.PROT_FAKE_ARGV_LOG) {
  appendFileSync(process.env.PROT_FAKE_ARGV_LOG, `${JSON.stringify({ bin: 'claude', argv: args, cwd: process.cwd() })}\n`)
}

function option(name) {
  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

const dash = args.indexOf('--')
const prompt = dash === -1 ? args[args.length - 1] : args.slice(dash + 1).join(' ')
const resumed = option('--resume')
const sessionId = args.includes('--fork-session') ? randomUUID() : (resumed ?? option('--session-id') ?? randomUUID())
const model = option('--model') ?? 'claude-opus-5-5'
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`)
const now = () => new Date().toISOString()

// Like the real CLI, keep a transcript under $CLAUDE_CONFIG_DIR so prot has to skip its own sessions.
function record(line) {
  if (!process.env.CLAUDE_CONFIG_DIR) return
  const dir = join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ ...line, sessionId, cwd: process.cwd(), timestamp: now() })}\n`)
}

let interrupted = false
process.on('SIGINT', () => {
  interrupted = true
  if (process.env.PROT_FAKE_ARGV_LOG) appendFileSync(process.env.PROT_FAKE_ARGV_LOG, `${JSON.stringify({ bin: 'claude', signal: 'SIGINT' })}\n`)
  process.exit(130)
})

record({ type: 'user', uuid: randomUUID(), origin: { kind: 'human' }, message: { role: 'user', content: prompt } })
emit({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sessionId, model, permissionMode: option('--permission-mode'), uuid: randomUUID() })
await sleep(40)

const messageId = `msg_${randomUUID().slice(0, 8)}`
const toolId = `toolu_${randomUUID().slice(0, 8)}`
const assistant = (id, content) => ({
  type: 'assistant',
  message: { model, id, type: 'message', role: 'assistant', content },
  parent_tool_use_id: null,
  session_id: sessionId,
  uuid: randomUUID()
})

emit(assistant(messageId, [{ type: 'text', text: 'Looking into it.' }]))
await sleep(40)

if (prompt.includes('FAIL')) {
  process.stderr.write('fake-claude: something went wrong\n')
  process.exit(1)
}

emit(assistant(messageId, [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: 'echo hi', description: 'Say hi' } }]))
await sleep(40)

if (prompt.includes('WAIT')) {
  while (!interrupted) await sleep(100)
}

emit({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    rateLimitType: 'five_hour',
    unifiedWindows: {
      five_hour: { utilization: 0.25, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
      seven_day: { utilization: 0.5, resetsAt: Math.floor(Date.now() / 1000) + 86400 }
    }
  },
  uuid: randomUUID(),
  session_id: sessionId
})
emit({
  type: 'user',
  message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content: 'hi' }] },
  parent_tool_use_id: null,
  session_id: sessionId,
  uuid: randomUUID()
})
await sleep(40)

const reply = `Echo: ${prompt}`
emit(assistant(`msg_${randomUUID().slice(0, 8)}`, [{ type: 'text', text: reply }]))
record({ type: 'assistant', uuid: randomUUID(), message: { model, id: messageId, role: 'assistant', content: [{ type: 'text', text: reply }] } })
await sleep(20)
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 180,
  num_turns: 2,
  result: reply,
  session_id: sessionId,
  total_cost_usd: 0.0123,
  usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 20 },
  uuid: randomUUID()
})
