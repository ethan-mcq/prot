import type { OutputStyle } from './types'

const STYLE_TEXT: Record<OutputStyle, string | null> = {
  concise: `Output style: concise.
- Lead with the answer or finding. No preamble, no restating the question, no closing recap.
- Use short plain sentences. Use lists or headings only when they carry real structure.
- Skip hedging. Mention a caveat only when it changes what the reader should do next.
- Give full detail when the reader asks for it.
- Never drop correctness, risks or security concerns for brevity.`,
  default: null
}

// Kept outside the versioned prompts so editing a prompt never removes the style.
export function withOutputStyle(system: string, style: OutputStyle): string {
  const text = STYLE_TEXT[style]
  return text === null ? system : `${system}\n\n${text}`
}

// The built-in agent system prompt: the concise style, until the user writes their own or imports an AGENTS.md.
export const AGENT_SYSTEM_PROMPT = STYLE_TEXT.concise ?? ''
