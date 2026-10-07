import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const svg = 'resources/logo.svg'
const iconset = 'resources/icon.iconset'
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)

for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
    execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), svg, '-o', join(iconset, name)])
  }
}
execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', svg, '-o', 'resources/icon.png'])
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'resources/icon.icns'])
rmSync(iconset, { recursive: true, force: true })
console.log('wrote resources/icon.png and resources/icon.icns')
