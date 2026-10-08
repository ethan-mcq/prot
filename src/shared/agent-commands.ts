import type { AgentCommand, AgentProvider } from './agents'

// A `/name` token at the start of the text or after whitespace.
const TOKEN = /(^|\s)\/([A-Za-z0-9][\w.:-]*)/g

export function findCommand(name: string, provider: AgentProvider, commands: AgentCommand[]): AgentCommand | null {
  let foreign: AgentCommand | null = null
  for (const command of commands) {
    if (command.name !== name) continue
    if (command.provider === provider) return command
    if (foreign === null && command.path !== null) foreign = command
  }
  return foreign
}

// Codex custom prompts take $ARGUMENTS and $1..$9 from the rest of the line.
export function fillArguments(body: string, args: string): string {
  const words = args.split(/\s+/).filter((word) => word !== '')
  return body.replace(/\$ARGUMENTS|\$([1-9])/g, (match, index: string | undefined) => {
    if (index === undefined) return args
    return words[Number(index) - 1] ?? ''
  })
}

// Rewrites /name tokens into what the agent's CLI understands. readBody returns a command file's body without frontmatter.
export function expandCommands(
  text: string,
  provider: AgentProvider,
  commands: AgentCommand[],
  readBody: (command: AgentCommand) => string | null
): string {
  let out = ''
  let last = 0
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(text)) !== null) {
    const start = match.index + (match[1] ?? '').length
    const name = match[2] ?? ''
    const end = start + 1 + name.length
    const command = findCommand(name, provider, commands)
    if (command === null) continue
    let replacement: string | null = null
    let until = end
    if (command.provider !== provider) {
      replacement = `Read and follow the skill at ${command.path}.`
    } else if (provider === 'claude') {
      if (text.slice(0, start).trim() !== '') replacement = `Use the ${name} skill.`
    } else if (command.kind === 'prompt') {
      const body = readBody(command)
      if (body !== null) {
        const lineEnd = text.indexOf('\n', end)
        until = lineEnd === -1 ? text.length : lineEnd
        replacement = fillArguments(body.trim(), text.slice(end, until).trim())
        TOKEN.lastIndex = until
      }
    } else if (command.kind === 'skill') {
      replacement = `$${name}`
    }
    if (replacement === null) continue
    out += text.slice(last, start) + replacement
    last = until
  }
  return out + text.slice(last)
}

export type CommandGroup = { provider: AgentProvider | null; commands: AgentCommand[] }

// The `/query` being typed right before the caret; null when the caret is not in one.
export function slashQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)\/([\w.:-]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: match.index + (match[1] ?? '').length, query: match[2] ?? '' }
}

// The agent's own provider first, then the skills folder, then the other provider; prefix matches first.
export function commandGroups(commands: AgentCommand[], provider: AgentProvider, query: string, limit = 60): CommandGroup[] {
  const needle = query.toLowerCase()
  const order: (AgentProvider | null)[] = [provider, null, provider === 'claude' ? 'codex' : 'claude']
  const groups: CommandGroup[] = []
  let left = limit
  for (const owner of order) {
    const prefix: AgentCommand[] = []
    const inner: AgentCommand[] = []
    for (const command of commands) {
      if (command.provider !== owner) continue
      // A foreign command without a file has nothing to point the agent at.
      if (owner !== provider && command.path === null) continue
      const name = command.name.toLowerCase()
      if (name.startsWith(needle)) prefix.push(command)
      else if (needle !== '' && name.includes(needle)) inner.push(command)
    }
    prefix.sort((a, b) => a.name.localeCompare(b.name))
    inner.sort((a, b) => a.name.localeCompare(b.name))
    const list = [...prefix, ...inner].slice(0, Math.max(0, left))
    left -= list.length
    if (list.length > 0) groups.push({ provider: owner, commands: list })
  }
  return groups
}
