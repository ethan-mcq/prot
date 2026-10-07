export function splitPath(path: string): { name: string; dir: string } {
  const slash = path.lastIndexOf('/')
  if (slash === -1) return { name: path, dir: '' }
  return { name: path.slice(slash + 1), dir: path.slice(0, slash) }
}

export function extension(path: string): string {
  const { name } = splitPath(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name.toLowerCase() : name.slice(dot + 1).toLowerCase()
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fileLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
