import { describe, expect, it } from 'vitest'
import type { AgentCommand } from './agents'
import { commandGroups, expandCommands, slashQuery } from './agent-commands'

const commands: AgentCommand[] = [
  { provider: 'claude', name: 'review', description: 'Review', kind: 'skill', path: '/c/skills/review/SKILL.md' },
  { provider: 'claude', name: 'compact', description: 'Compact', kind: 'builtin', path: null },
  { provider: 'codex', name: 'deploy', description: 'Deploy', kind: 'skill', path: '/x/skills/deploy/SKILL.md' },
  { provider: 'codex', name: 'prompts:fix', description: 'Fix', kind: 'prompt', path: '/x/prompts/fix.md' },
  { provider: 'codex', name: 'status', description: 'Built in', kind: 'builtin', path: null },
  { provider: null, name: 'notes', description: 'Notes', kind: 'skill', path: '/f/skills/notes/SKILL.md' }
]

describe('expandCommands', () => {
  const body = () => 'Fix $1 then $ARGUMENTS'

  it('keeps a native Claude command at the start and rewrites the rest', () => {
    expect(expandCommands('/review now', 'claude', commands, body)).toBe('/review now')
    expect(expandCommands('then /review', 'claude', commands, body)).toBe('then Use the review skill.')
    expect(expandCommands('/deploy it', 'claude', commands, body)).toBe('Read and follow the skill at /x/skills/deploy/SKILL.md. it')
    expect(expandCommands('/notes and /unknown', 'claude', commands, body)).toBe('Read and follow the skill at /f/skills/notes/SKILL.md. and /unknown')
  })

  it('turns Codex skills into $name and inlines custom prompts with their arguments', () => {
    expect(expandCommands('/deploy now', 'codex', commands, body)).toBe('$deploy now')
    expect(expandCommands('/prompts:fix login fast\nmore', 'codex', commands, body)).toBe('Fix login then login fast\nmore')
    expect(expandCommands('/review', 'codex', commands, body)).toBe('Read and follow the skill at /c/skills/review/SKILL.md.')
  })
})

describe('the / menu', () => {
  it('finds the token before the caret', () => {
    expect(slashQuery('fix /rev', 8)).toEqual({ start: 4, query: 'rev' })
    expect(slashQuery('a/b', 3)).toBeNull()
  })

  it('orders own provider, skills folder, then the other provider, and drops foreign built-ins', () => {
    const groups = commandGroups(commands, 'codex', '')
    expect(groups.map((group) => [group.provider, group.commands.map((command) => command.name)])).toEqual([
      ['codex', ['deploy', 'prompts:fix', 'status']],
      [null, ['notes']],
      ['claude', ['review']]
    ])
    expect(commandGroups(commands, 'claude', 'fix').map((group) => group.commands.map((command) => command.name))).toEqual([['prompts:fix']])
  })
})
