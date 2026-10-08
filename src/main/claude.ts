import Anthropic from '@anthropic-ai/sdk'
import type { AiModel, Effort } from '@shared/types'
import type { SecretsStore } from './secrets'

// Haiku 5.5 has adaptive thinking and effort but no server-side refusal fallback; sending one is a 400.
const CAPABILITIES: Record<AiModel, { fallback: boolean }> = {
  'claude-opus-5-5': { fallback: true },
  'claude-sonnet-5-5': { fallback: true },
  'claude-haiku-5-5': { fallback: false }
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
  output.effort = effort
  const params: ModelParams = { thinking: { type: 'adaptive' }, output_config: output }
  if (CAPABILITIES[model].fallback) {
    params.betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  return params
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
