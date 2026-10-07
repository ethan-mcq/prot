import { describe, expect, it } from 'vitest'
import { parsePatch } from './diff'

describe('parsePatch', () => {
  it('numbers each side across hunks and keeps the section header', () => {
    const patch = [
      '@@ -10,4 +10,5 @@ function greet(name) {',
      '   const a = 1',
      '-  const b = 2',
      '+  const b = 3',
      '+  const c = 4',
      '',
      '   return a',
      '@@ -40,2 +41,1 @@',
      '-  gone()',
      '   end()'
    ].join('\n')

    expect(parsePatch(patch)).toEqual([
      {
        header: '@@ -10,4 +10,5 @@ function greet(name) {',
        section: 'function greet(name) {',
        oldStart: 10,
        oldLines: 4,
        newStart: 10,
        newLines: 5,
        lines: [
          { kind: 'context', oldLine: 10, newLine: 10, text: '  const a = 1' },
          { kind: 'del', oldLine: 11, newLine: null, text: '  const b = 2' },
          { kind: 'add', oldLine: null, newLine: 11, text: '  const b = 3' },
          { kind: 'add', oldLine: null, newLine: 12, text: '  const c = 4' },
          { kind: 'context', oldLine: 12, newLine: 13, text: '' },
          { kind: 'context', oldLine: 13, newLine: 14, text: '  return a' }
        ]
      },
      {
        header: '@@ -40,2 +41,1 @@',
        section: null,
        oldStart: 40,
        oldLines: 2,
        newStart: 41,
        newLines: 1,
        lines: [
          { kind: 'del', oldLine: 40, newLine: null, text: '  gone()' },
          { kind: 'context', oldLine: 41, newLine: 41, text: '  end()' }
        ]
      }
    ])
  })

  it('reads omitted counts as one line and skips no-newline markers', () => {
    const patch = ['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file', ''].join('\n')

    expect(parsePatch(patch)).toEqual([
      {
        header: '@@ -1 +1 @@',
        section: null,
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: 'del', oldLine: 1, newLine: null, text: 'a' },
          { kind: 'add', oldLine: null, newLine: 1, text: 'b' }
        ]
      }
    ])
    expect(parsePatch('')).toEqual([])
  })
})
