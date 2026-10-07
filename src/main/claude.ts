import Anthropic from '@anthropic-ai/sdk'
import type { AiModel, Effort } from '@shared/types'
import type { SecretsStore } from './secrets'

// Haiku 4.5 predates adaptive thinking, effort and server-side refusal fallback.
const SUPPORTS_ADAPTIVE: Record<AiModel, boolean> = {
  'claude-opus-5-5': true,
  'claude-sonnet-5-5': true,
  'claude-haiku-4-5': false
}

export type ModelParams = {
  thinking?: Anthropic.Beta.BetaThinkingConfigAdaptive
  betas?: string[]
  fallbacks?: 'default'
  output_config?: Anthropic.Beta.BetaOutputConfig
}

export function modelParams(
  model: AiModel,
  effort: Effort,
  format?: Anthropic.Beta.BetaJSONOutputFormat
): ModelParams {
  const output: Anthropic.Beta.BetaOutputConfig = {}
  if (format) output.format = format
  if (!SUPPORTS_ADAPTIVE[model]) return format ? { output_config: output } : {}
  output.effort = effort
  return {
    thinking: { type: 'adaptive' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: output
  }
}

export async function createClient(secrets: SecretsStore): Promise<Anthropic> {
  const apiKey = await secrets.anthropicKey()
  if (!apiKey) {
    throw new Error('Add an Anthropic API key in the chat widget to use AI features.')
  }
  return new Anthropic({ apiKey })
}

export function refusalMessage(details: { explanation?: string | null } | null | undefined): string {
  const reason = details?.explanation ? ` ${details.explanation}` : ''
  return `Claude declined to answer this request.${reason}`
}

export function describeAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key. Update it in the chat widget.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit reached. Try again in a moment.'
  }
  if (error instanceof Anthropic.APIError) return `Anthropic API error (${error.status}): ${error.message}`
  return error instanceof Error ? error.message : String(error)
}
