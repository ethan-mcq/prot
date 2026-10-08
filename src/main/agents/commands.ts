import { readFileSync, statSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { AgentCommand, AgentCommandKind, AgentProvider } from '@shared/agents'

const HEAD_BYTES = 16 * 1024
const BODY_MAX = 64 * 1024
const DESCRIPTION_MAX = 300
const COMMAND_DEPTH = 3

// Interactive commands that do nothing in a headless `claude -p` turn. /compact stays.
const HEADLESS_NOOPS = new Set([
  'add-dir',
  'agents',
  'auto-mode-setup',
  'autocompact',
  'bug',
  'clear',
  'color',
  'config',
  'context',
  'cost',
  'design-consent',
  'design-revoke',
  'doctor',
  'effort',
  'exit',
  'export',
  'extra-usage',
  'fast',
  'feedback',
  'heapdump',
  'help',
  'hooks',
  'ide',
  'import',
  'insights',
  'install-github-app',
  'list-agents',
  'login',
  'logout',
  'mcp',
  'memory',
  'model',
  'output-style',
  'permissions',
  'plugin',
  'plugin-types',
  'privacy-settings',
  'release-notes',
  'reload-plugins',
  'reload-skills',
  'rename',
  'resume',
  'rewind',
  'skill-doctor',
  'status',
  'statusline',
  'team-onboarding',
  'terminal-setup',
  'theme',
  'upgrade',
  'usage',
  'usage-credits',
  'vim',
  'workflow-launch-exec'
])

export function isHeadlessNoop(name: string): boolean {
  return name.startsWith('__') || HEADLESS_NOOPS.has(name)
}

export type CachedCommand = { name: string; description: string; builtin: boolean }

export type DiscoverInput = {
  repoPath: string | null
  home: string
  claudeDir: string
  codexHome: string
  // settings.agentFolder: Claude loads its .claude/skills through --add-dir; its skills/ and commands/ are prot's own.
  agentFolder: string | null
  // The newest system/commands_changed list a Claude agent in this repo reported.
  cached: CachedCommand[]
}

type Frontmatter = { fields: Record<string, string>; body: string }

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

// Top-level `key: value` pairs only, plus `>` / `|` block scalars; enough for name and description.
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return { fields: {}, body: text }
  const fields: Record<string, string> = {}
  let i = 1
  for (; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '---') break
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match || !match[1]) continue
    const key = match[1]
    const value = (match[2] ?? '').trim()
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = []
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1] ?? '') && (lines[i + 1] ?? '').trim() !== '---') {
        i++
        block.push((lines[i] ?? '').trim())
      }
      fields[key] = value.startsWith('>') ? block.join(' ').trim() : block.join('\n').trim()
    } else fields[key] = unquote(value)
  }
  return { fields, body: lines.slice(i + 1).join('\n') }
}

function firstLine(body: string): string {
  for (const line of body.split('\n')) {
    const text = line.replace(/^#+\s*/, '').trim()
    if (text !== '') return text
  }
  return ''
}

async function readHead(path: string, bytes = HEAD_BYTES): Promise<string | null> {
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function describe(
  provider: AgentProvider | null,
  path: string,
  fallbackName: string,
  kind: AgentCommandKind,
  namespace: string | null
): Promise<AgentCommand | null> {
  const text = await readHead(path)
  if (text === null) return null
  const { fields, body } = parseFrontmatter(text)
  // Codex custom prompts and Claude commands are named after their file; skills may rename themselves.
  const own = kind === 'skill' && fields.name?.trim() ? fields.name.trim() : fallbackName
  const name = namespace ? `${namespace}:${own}` : own
  const description = (fields.description?.trim() || firstLine(body)).slice(0, DESCRIPTION_MAX)
  return { provider, name, description, kind, path }
}

// <root>/<dir>/SKILL.md for each non-hidden dir.
async function skillsIn(provider: AgentProvider | null, root: string, namespace: string | null = null): Promise<AgentCommand[]> {
  const out: AgentCommand[] = []
  for (const name of await listDir(root)) {
    if (name.startsWith('.')) continue
    const file = join(root, name, 'SKILL.md')
    if (!(await isFile(file))) continue
    const command = await describe(provider, file, name, 'skill', namespace)
    if (command) out.push(command)
  }
  return out
}

// Every SKILL.md up to `depth` dirs down, hidden dirs included (Codex keeps its system skills in .system).
async function skillsDeep(provider: AgentProvider, root: string, depth: number): Promise<AgentCommand[]> {
  const out: AgentCommand[] = []
  const visit = async (dir: string, left: number) => {
    for (const name of await listDir(dir)) {
      const path = join(dir, name)
      if (!(await isDir(path))) continue
      const file = join(path, 'SKILL.md')
      if (await isFile(file)) {
        const command = await describe(provider, file, name, 'skill', null)
        if (command) out.push(command)
      } else if (left > 1) await visit(path, left - 1)
    }
  }
  await visit(root, depth)
  return out
}

// Claude names commands/<a>/<b>.md as a:b.
async function commandsIn(root: string, namespace: string | null = null, provider: AgentProvider | null = 'claude'): Promise<AgentCommand[]> {
  const out: AgentCommand[] = []
  const visit = async (dir: string, left: number) => {
    for (const name of await listDir(dir)) {
      if (name.startsWith('.')) continue
      const path = join(dir, name)
      if (name.endsWith('.md') && (await isFile(path))) {
        const own = relative(root, path).slice(0, -3).split(sep).join(':')
        const command = await describe(provider, path, own, 'command', namespace)
        if (command) out.push(command)
      } else if (left > 1 && (await isDir(path))) await visit(path, left - 1)
    }
  }
  await visit(root, COMMAND_DEPTH)
  return out
}

// The start dir and each parent up to and including home, or up to / when start is outside home.
export function ancestors(start: string, home: string): string[] {
  const dirs: string[] = []
  let dir = resolve(start)
  const top = resolve(home)
  for (;;) {
    dirs.push(dir)
    if (dir === top) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dirs
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

// Synced bucket plugins plus installed_plugins.json, minus plugins settings.json turns off.
async function claudePluginRoots(claudeDir: string): Promise<{ name: string; root: string }[]> {
  const roots: { name: string; root: string }[] = []
  const synced = join(claudeDir, 'plugins', 'synced')
  for (const bucket of await listDir(synced)) {
    if (bucket.startsWith('.')) continue
    for (const name of await listDir(join(synced, bucket))) {
      const root = join(synced, bucket, name)
      if (!name.startsWith('.') && (await isDir(root))) roots.push({ name, root })
    }
  }
  const settings = (await readJson(join(claudeDir, 'settings.json'))) as { enabledPlugins?: Record<string, unknown> } | null
  const installed = (await readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))) as { plugins?: Record<string, unknown> } | null
  for (const [key, value] of Object.entries(installed?.plugins ?? {})) {
    if (settings?.enabledPlugins?.[key] === false) continue
    const entries = Array.isArray(value) ? value : [value]
    for (const entry of entries as { installPath?: unknown }[]) {
      if (typeof entry?.installPath === 'string') roots.push({ name: key.split('@')[0] ?? key, root: entry.installPath })
    }
  }
  return roots
}

// [plugins."name@market"] tables with enabled = true.
export function enabledCodexPlugins(toml: string): string[] {
  const enabled: string[] = []
  let current: string | null = null
  for (const line of toml.split('\n')) {
    const trimmed = line.trim()
    const header = /^\[plugins\."([^"]+)"\]$/.exec(trimmed)
    if (header && header[1]) {
      current = header[1]
      continue
    }
    if (trimmed.startsWith('[')) {
      current = null
      continue
    }
    if (current !== null && /^enabled\s*=\s*true\b/.test(trimmed)) enabled.push(current)
  }
  return enabled
}

async function codexPluginRoots(codexHome: string): Promise<{ name: string; root: string }[]> {
  let toml = ''
  try {
    toml = await readFile(join(codexHome, 'config.toml'), 'utf8')
  } catch {
    return []
  }
  const roots: { name: string; root: string }[] = []
  for (const id of enabledCodexPlugins(toml)) {
    const [name, market] = id.split('@')
    if (!name || !market) continue
    const dir = join(codexHome, 'plugins', 'cache', market, name)
    const versions = (await listDir(dir)).filter((version) => !version.startsWith('.'))
    const newest = versions[versions.length - 1]
    if (newest) roots.push({ name, root: join(dir, newest) })
  }
  return roots
}

const SOURCE_TAG = /\s+\((?:user|project|managed|bundled|plugin[^)]*)\)$/

async function claudeCommands(input: DiscoverInput): Promise<AgentCommand[]> {
  const found: AgentCommand[] = []
  const userSkills = join(input.claudeDir, 'skills')
  if (input.repoPath) {
    for (const dir of ancestors(input.repoPath, input.home)) {
      const skills = join(dir, '.claude', 'skills')
      if (resolve(skills) !== resolve(userSkills)) found.push(...(await skillsIn('claude', skills)))
      const commands = join(dir, '.claude', 'commands')
      if (resolve(commands) !== resolve(join(input.claudeDir, 'commands'))) found.push(...(await commandsIn(commands)))
    }
  }
  if (input.agentFolder) found.push(...(await skillsIn('claude', join(input.agentFolder, '.claude', 'skills'))))
  found.push(...(await skillsIn('claude', userSkills)))
  found.push(...(await commandsIn(join(input.claudeDir, 'commands'))))
  for (const bucket of await listDir(join(userSkills, 'synced'))) {
    if (!bucket.startsWith('.')) found.push(...(await skillsIn('claude', join(userSkills, 'synced', bucket), 'anthropic-skills')))
  }
  for (const plugin of await claudePluginRoots(input.claudeDir)) {
    found.push(...(await skillsIn('claude', join(plugin.root, 'skills'), plugin.name)))
    found.push(...(await commandsIn(join(plugin.root, 'commands'), plugin.name)))
  }
  const byName = new Map<string, AgentCommand>()
  for (const command of found) {
    if (!byName.has(command.name)) byName.set(command.name, command)
  }
  for (const entry of input.cached) {
    if (isHeadlessNoop(entry.name)) continue
    const known = byName.get(entry.name)
    const description = entry.description.replace(SOURCE_TAG, '').slice(0, DESCRIPTION_MAX)
    if (known) {
      if (known.description === '') known.description = description
      continue
    }
    byName.set(entry.name, { provider: 'claude', name: entry.name, description, kind: entry.builtin ? 'builtin' : 'skill', path: null })
  }
  if (!byName.has('compact')) {
    byName.set('compact', { provider: 'claude', name: 'compact', description: 'Clear history but keep a summary in context', kind: 'builtin', path: null })
  }
  return [...byName.values()]
}

async function codexCommands(input: DiscoverInput): Promise<AgentCommand[]> {
  const found: AgentCommand[] = []
  if (input.repoPath) {
    for (const dir of ancestors(input.repoPath, input.home)) {
      found.push(...(await skillsIn('codex', join(dir, '.agents', 'skills'))))
      if (resolve(join(dir, '.codex')) !== resolve(input.codexHome)) found.push(...(await skillsIn('codex', join(dir, '.codex', 'skills'))))
    }
  } else found.push(...(await skillsIn('codex', join(input.home, '.agents', 'skills'))))
  found.push(...(await skillsDeep('codex', join(input.codexHome, 'skills'), 3)))
  for (const plugin of await codexPluginRoots(input.codexHome)) {
    found.push(...(await skillsIn('codex', join(plugin.root, 'skills'), plugin.name)))
  }
  const prompts = join(input.codexHome, 'prompts')
  for (const name of await listDir(prompts)) {
    if (!name.endsWith('.md') || name.startsWith('.')) continue
    const command = await describe('codex', join(prompts, name), `prompts:${basename(name, '.md')}`, 'prompt', null)
    if (command) found.push(command)
  }
  const byName = new Map<string, AgentCommand>()
  for (const command of found) {
    if (!byName.has(command.name)) byName.set(command.name, command)
  }
  return [...byName.values()]
}

async function folderCommands(folder: string | null): Promise<AgentCommand[]> {
  if (!folder) return []
  const found = [
    ...(await skillsIn(null, join(folder, 'skills'))),
    ...(await commandsIn(join(folder, 'commands'), null, null)),
    ...(await commandsIn(join(folder, '.claude', 'commands'), null, null))
  ]
  const byName = new Map<string, AgentCommand>()
  for (const command of found) {
    if (!byName.has(command.name)) byName.set(command.name, command)
  }
  return [...byName.values()]
}

// Every skill and command either CLI would load for a folder, plus the skills folder's own.
export async function discoverCommands(input: DiscoverInput): Promise<AgentCommand[]> {
  const [claude, codex, folder] = await Promise.all([claudeCommands(input), codexCommands(input), folderCommands(input.agentFolder)])
  return [...claude, ...codex, ...folder]
}

// A command file's text without its frontmatter, for inlining Codex custom prompts.
export function commandBody(path: string): string | null {
  try {
    if (statSync(path).size > BODY_MAX) return null
    return parseFrontmatter(readFileSync(path, 'utf8')).body
  } catch {
    return null
  }
}

export function parseCommandsChanged(raw: unknown): CachedCommand[] | null {
  if (!Array.isArray(raw)) return null
  const out: CachedCommand[] = []
  for (const item of raw as { name?: unknown; description?: unknown; builtin?: unknown }[]) {
    if (typeof item?.name !== 'string' || item.name === '') continue
    out.push({ name: item.name, description: typeof item.description === 'string' ? item.description : '', builtin: item.builtin === true })
  }
  return out
}
