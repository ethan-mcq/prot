import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findAgentsMd } from './instructions'

let root: string | null = null

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = null
})

describe('findAgentsMd', () => {
  it('returns the shallowest AGENTS.md and skips node_modules', () => {
    root = mkdtempSync(join(tmpdir(), 'prot-instructions-'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'AGENTS.md'), 'x')
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'AGENTS.md'), 'deep')
    mkdirSync(join(root, 'z'))
    writeFileSync(join(root, 'z', 'agents.md'), 'shallow')
    return expect(findAgentsMd(root)).resolves.toBe(join(root, 'z', 'agents.md'))
  })

  it('is null when the repo has none', () => {
    root = mkdtempSync(join(tmpdir(), 'prot-instructions-'))
    return expect(findAgentsMd(root)).resolves.toBeNull()
  })
})
