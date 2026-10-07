import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const source = join('release', `mac-${process.arch}`, 'prot.app')
if (!existsSync(source)) {
  console.error(`missing ${source}, run npm run package first`)
  process.exit(1)
}
const dir = join(homedir(), 'Applications')
const target = join(dir, 'prot.app')
mkdirSync(dir, { recursive: true })
rmSync(target, { recursive: true, force: true })
renameSync(source, target)
console.log(`installed ${target}`)
