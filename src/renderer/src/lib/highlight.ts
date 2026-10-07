import { createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { extension, splitPath } from './paths'

export type Token = { content: string; style: Record<string, string> }

type Grammar = () => Promise<{ default: LanguageRegistration[] }>

const GRAMMARS: Record<string, Grammar> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  xml: () => import('shiki/langs/xml.mjs')
}

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  go: 'go',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  java: 'java',
  rb: 'ruby',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  html: 'html',
  htm: 'html',
  gradle: 'groovy',
  groovy: 'groovy',
  xml: 'xml',
  plist: 'xml',
  svg: 'xml'
}

export function languageFor(path: string): string | null {
  const { name } = splitPath(path)
  if (name === 'Dockerfile' || name === '.bashrc' || name === '.zshrc') return 'shellscript'
  return BY_EXTENSION[extension(path)] ?? null
}

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  })
  return highlighter
}

async function loadLanguage(core: HighlighterCore, lang: string): Promise<void> {
  const grammar = GRAMMARS[lang]
  if (!grammar) return
  let pending = loading.get(lang)
  if (!pending) {
    pending = grammar().then((mod) => core.loadLanguage(mod.default))
    loading.set(lang, pending)
  }
  await pending
}

const MAX_LINE = 2000

export async function highlightLines(lines: string[], lang: string): Promise<Token[][]> {
  const core = await getHighlighter()
  await loadLanguage(core, lang)
  const result = core.codeToTokens(lines.join('\n'), {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    tokenizeMaxLineLength: MAX_LINE
  })
  return result.tokens.map((line) => line.map((token) => ({ content: token.content, style: token.htmlStyle ?? {} })))
}
