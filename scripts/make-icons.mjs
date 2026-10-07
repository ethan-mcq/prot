import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sprite = readFileSync('resources/logo.png').toString('base64')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024">
  <defs>
    <filter id="s" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="#ffffff" stroke="#e7e7e5" stroke-width="4" filter="url(#s)"/>
  <image x="182" y="182" width="660" height="660" xlink:href="data:image/png;base64,${sprite}"/>
</svg>`

const tileSvg = 'resources/icon-tile.svg'
const iconset = 'resources/icon.iconset'
writeFileSync(tileSvg, svg)
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)

for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale
    const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
    execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), tileSvg, '-o', join(iconset, name)])
  }
}
execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', tileSvg, '-o', 'resources/icon.png'])
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', 'resources/icon.icns'])
rmSync(iconset, { recursive: true, force: true })
rmSync(tileSvg)
console.log('wrote resources/icon.png and resources/icon.icns')
