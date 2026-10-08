import type { AgentEvent, UsageWindow } from '@shared/agents'

export type ToolEvent = Extract<AgentEvent, { kind: 'tool' }>

export const TOOL_OUTPUT_MAX = 4096
const SUMMARY_MAX = 240

export function truncateOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_MAX) return text
  return `${text.slice(0, TOOL_OUTPUT_MAX)}\n… ${text.length - TOOL_OUTPUT_MAX} more characters`
}

export function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
}

const SUMMARY_KEYS = ['command', 'cmd', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt', 'skill', 'title']

// The one field a reader needs to know what a tool call touched.
export function toolSummary(input: unknown): string {
  if (typeof input === 'string') return oneLine(input)
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim() !== '') {
      if (key === 'pattern' && typeof fields.path === 'string') return oneLine(`${value} in ${fields.path}`)
      return oneLine(value)
    }
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return oneLine(unwrapShell(value as string[]))
  }
  for (const value of Object.values(fields)) {
    if (typeof value === 'string' && value.trim() !== '') return oneLine(value)
  }
  return ''
}

// ["/bin/zsh", "-lc", "cat a.txt"] and "/bin/zsh -lc 'cat a.txt'" both read as `cat a.txt`.
export function unwrapShell(command: string | string[]): string {
  if (Array.isArray(command)) {
    if (command.length === 3 && /(^|\/)(ba|z|fi)?sh$/.test(command[0] ?? '') && /^-l?c$/.test(command[1] ?? '')) {
      return command[2] ?? ''
    }
    return command.join(' ')
  }
  const match = /^\S*\/?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command)
  if (match && match[2] !== undefined) {
    return match[1] === "'" ? match[2].replace(/'\\''/g, "'") : match[2]
  }
  return command
}

export function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day`
  if (minutes % 60 === 0) return `${minutes / 60} hour`
  return `${minutes} min`
}

// Epoch seconds or milliseconds to whole seconds.
export function epochSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value < 1e12 ? value : value / 1000)
}

export function usageWindow(label: string, usedPercent: unknown, resetsAt: unknown): UsageWindow | null {
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null
  return { label, usedPercent: Math.round(usedPercent * 10) / 10, resetsAt: epochSeconds(resetsAt) }
}

export function promptTitle(prompt: string): string {
  const first = prompt.trim().split('\n')[0] ?? ''
  const line = oneLine(first)
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || 'Untitled agent'
}
