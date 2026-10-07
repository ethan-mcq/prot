import Anthropic from '@anthropic-ai/sdk'
import { IPC } from '@shared/ipc'
import type { ChatEvent, ChatRequest } from '@shared/types'
import { attachViewContext, buildChatSystem } from './chat-context'
import { createClient, describeAiError, modelParams, refusalMessage } from './claude'
import type { PullService } from './pulls'
import type { SecretsStore } from './secrets'
import type { SettingsStore } from './settings'

const CHAT_MAX_TOKENS = 16_000

export class ChatService {
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly secrets: SecretsStore,
    private readonly settings: SettingsStore,
    private readonly pulls: PullService,
    private readonly emit: (channel: string, event: ChatEvent) => void
  ) {}

  start(req: ChatRequest): void {
    if (this.active.has(req.id)) throw new Error(`Chat request ${req.id} is already running`)
    const controller = new AbortController()
    this.active.set(req.id, controller)
    void this.run(req, controller).finally(() => this.active.delete(req.id))
  }

  cancel(id: string): void {
    this.active.get(id)?.abort()
  }

  private send(event: ChatEvent): void {
    this.emit(IPC.aiEvent, event)
  }

  private async run(req: ChatRequest, controller: AbortController): Promise<void> {
    try {
      const client = await createClient(this.secrets)
      const pull = req.context.pull
      const detail = pull ? await this.pulls.cached(pull.ref) : null
      const stream = client.beta.messages.stream(
        {
          model: this.settings.get().model,
          max_tokens: CHAT_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: buildChatSystem(detail),
              cache_control: { type: 'ephemeral' }
            }
          ],
          messages: attachViewContext(req.messages, req.context),
          ...modelParams(this.settings.get().model, 'medium')
        },
        { signal: controller.signal }
      )
      stream.on('text', (text) => this.send({ id: req.id, type: 'delta', text }))
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') {
        this.send({ id: req.id, type: 'error', message: refusalMessage(message.stop_details) })
        return
      }
      this.send({ id: req.id, type: 'done' })
    } catch (error) {
      if (controller.signal.aborted || error instanceof Anthropic.APIUserAbortError) {
        this.send({ id: req.id, type: 'done' })
        return
      }
      this.send({ id: req.id, type: 'error', message: describeAiError(error) })
    }
  }
}
