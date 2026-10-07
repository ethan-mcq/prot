import { Braces, Database, FileCode2, FileCog, FileImage, FileTerminal, FileText, FlaskConical, type LucideIcon } from 'lucide-react'
import { classifyFile } from '@shared/guide'
import { extension } from '@/lib/paths'
import { cn } from '@/lib/utils'

const EXTENSION_ICONS: Record<string, LucideIcon> = {
  json: Braces,
  md: FileText,
  mdx: FileText,
  txt: FileText,
  sql: Database,
  sh: FileTerminal,
  bash: FileTerminal,
  zsh: FileTerminal,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  yml: FileCog,
  yaml: FileCog,
  toml: FileCog,
  gradle: FileCog,
  lock: FileCog,
  plist: FileCog,
  xml: FileCog
}

const EXTENSION_TINTS: Record<string, string> = {
  ts: 'text-sky-600 dark:text-sky-400',
  tsx: 'text-sky-600 dark:text-sky-400',
  js: 'text-amber-600 dark:text-amber-400',
  jsx: 'text-amber-600 dark:text-amber-400',
  kt: 'text-violet-600 dark:text-violet-400',
  kts: 'text-violet-600 dark:text-violet-400',
  swift: 'text-orange-600 dark:text-orange-400',
  py: 'text-blue-600 dark:text-blue-400',
  go: 'text-cyan-600 dark:text-cyan-400',
  rs: 'text-orange-700 dark:text-orange-400',
  java: 'text-red-600 dark:text-red-400',
  rb: 'text-rose-600 dark:text-rose-400'
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const role = classifyFile(path)
  const ext = extension(path)
  const Icon = role === 'test' ? FlaskConical : role === 'schema' ? Database : (EXTENSION_ICONS[ext] ?? FileCode2)
  return (
    <Icon
      aria-hidden
      className={cn('size-4 shrink-0', EXTENSION_TINTS[ext] ?? 'text-muted-foreground', className)}
      strokeWidth={1.75}
    />
  )
}
