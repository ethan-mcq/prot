import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import type { GrammarFiles } from './indexer'

const require = createRequire(import.meta.url)

// electron-builder unpacks the runtime next to app.asar, so read it from there in the packaged app.
function unpacked(path: string): string {
  return path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

// The packaged app ships the grammars as extra resources: tree-sitter-wasms lists itself as a dependency,
// which sends electron-builder's node_modules walk into an endless loop, so it stays a dev dependency.
function grammarDir(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath
  const packaged = resources === undefined ? null : join(resources, 'tree-sitter-wasms')
  if (packaged !== null && existsSync(packaged)) return packaged
  return join(dirname(require.resolve('tree-sitter-wasms/package.json')), 'out')
}

export function grammarFiles(): GrammarFiles {
  const runtime = unpacked(join(dirname(require.resolve('web-tree-sitter')), 'tree-sitter.wasm'))
  const grammars = grammarDir()
  return { runtime, grammar: (name) => join(grammars, `tree-sitter-${name}.wasm`) }
}
