import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as pr from './share-pr'
import * as tools from './tools-pr'

export const TEST_TOKEN = 'ghp_fixture_token'

export type Recorded = { method: string; path: string; body: unknown }

export type FixtureServer = {
  url: string
  requests: Recorded[]
  close(): Promise<void>
}

export type GitHubFixture = FixtureServer & {
  push(): void
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      if (!raw) resolve(null)
      else resolve(JSON.parse(raw))
    })
  })
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function png(res: ServerResponse, bytes: Buffer) {
  res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length })
  res.end(bytes)
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

function closer(server: Server) {
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
}

export async function startGitHub(): Promise<GitHubFixture> {
  const requests: Recorded[] = []
  const prPath = `/repos/${pr.pull.owner}/${pr.pull.repo}`
  let state = pr.openedState
  const replies: ReturnType<typeof pr.reply>[] = []
  let base = ''

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    const body = await readBody(req)
    requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body })

    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return json(res, 401, { message: 'Bad credentials' })
    }

    const p = url.pathname
    const full = (req.headers.accept ?? '').includes('full+json')
    if (p === pr.attachmentPaths.sheet) return png(res, pr.screenshotPng([22, 163, 74]))
    if (p === pr.attachmentPaths.inbox) return png(res, pr.screenshotPng([37, 99, 235]))
    if (p === pr.attachmentPaths.log) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end(pr.intentLog)
    }
    if (p === '/user') return json(res, 200, pr.viewerUser)
    if (p === '/graphql' && req.method === 'POST') {
      const { query, variables } = body as { query: string; variables: Record<string, string | number> }
      if (query.startsWith('query Pulls(')) return json(res, 200, pullsByAlias(variables, state))
      const q = String(variables.q ?? '')
      if (q.includes('review-requested:@me')) return json(res, 200, pr.reviewSearch(state))
      if (q.includes('author:@me')) return json(res, 200, pr.mineSearch())
      return json(res, 200, { errors: [{ message: `fixture has no search for ${q}` }] })
    }
    const toolsRoute = p.match(new RegExp(`^${tools.toolsPath}/pulls/(\\d+)(/files|/comments|/reviews)?$`))
    if (toolsRoute) {
      const pull = tools.toolsPull(Number(toolsRoute[1]))
      if (pull === null) return json(res, 404, { message: 'Not Found' })
      if (toolsRoute[2] === '/files') return json(res, 200, url.searchParams.get('page') === '1' ? tools.toolsFiles : [])
      if (toolsRoute[2]) return json(res, 200, [])
      return json(res, 200, tools.toolsDetail(pull))
    }
    if (p.startsWith(`${tools.toolsPath}/contents/`)) {
      const content = tools.toolsContent(decodeURIComponent(p.slice(`${tools.toolsPath}/contents/`.length)), url.searchParams.get('ref'))
      if (content === null) return json(res, 404, { message: 'Not Found' })
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end(content)
    }
    if (p.startsWith(`${tools.toolsPath}/git/trees/`)) {
      return json(res, 200, { truncated: false, tree: tools.toolsTree().map((path) => ({ path, type: 'blob' })) })
    }
    if (p === `${prPath}/pulls/${pr.pull.number}`) return json(res, 200, pr.pullDetail(state, base, full))
    if (p === `${prPath}/pulls/${pr.pull.number}/files`) {
      const page = Number(url.searchParams.get('page') ?? '1')
      return json(res, 200, page === 1 ? state.files : [])
    }
    if (p === `${prPath}/pulls/${pr.pull.number}/comments`) return json(res, 200, [...pr.reviewComments, ...replies])
    const replyTo = p.match(new RegExp(`^${prPath}/pulls/${pr.pull.number}/comments/(\\d+)/replies$`))
    if (replyTo && req.method === 'POST') {
      const created = pr.reply(Number(replyTo[1]), (body as { body: string }).body, 9100 + replies.length)
      if (created === null) return json(res, 404, { message: 'Not Found' })
      replies.push(created)
      return json(res, 201, created)
    }
    if (p === `${prPath}/pulls/${pr.pull.number}/reviews`) {
      if (req.method === 'POST') return json(res, 200, { id: 7002, state: 'APPROVED' })
      return json(res, 200, pr.reviews(base))
    }
    if (p === `${prPath}/issues/${pr.pull.number}/comments` && req.method === 'POST') {
      return json(res, 201, { id: 5001 })
    }
    if (p.startsWith(`${prPath}/contents/`)) {
      const path = decodeURIComponent(p.slice(`${prPath}/contents/`.length))
      const content = pr.fileContent(state, path, url.searchParams.get('ref'))
      if (content === null) return json(res, 404, { message: 'Not Found' })
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end(content)
    }
    if (p === `${prPath}/git/trees/${state.headSha}`) {
      return json(res, 200, {
        sha: state.headSha,
        truncated: false,
        tree: pr.tree(state).map((path) => ({ path, type: 'blob' }))
      })
    }
    return json(res, 404, { message: `fixture has no route for ${req.method} ${p}` })
  })

  base = await listen(server)
  return {
    url: base,
    requests,
    close: closer(server),
    push: () => {
      state = pr.pushedState
    }
  }
}

type GraphqlNode = { number: number; repository: { nameWithOwner: string } }

// Answers the aliased `query Pulls` the way GitHub does: a NOT_FOUND error per alias it cannot resolve.
function pullsByAlias(variables: Record<string, string | number>, state: pr.PullState) {
  const known = new Map<string, GraphqlNode>()
  const nodes: GraphqlNode[] = [...pr.reviewSearch(state).data.search.nodes, ...pr.mineSearch().data.search.nodes]
  for (const pull of tools.toolsPulls) nodes.push(tools.toolsNode(pull))
  for (const node of nodes) known.set(`${node.repository.nameWithOwner}#${node.number}`, node)

  const data: Record<string, { pullRequest: GraphqlNode } | null> = {}
  const errors: { type: string; path: string[]; message: string }[] = []
  for (let i = 0; `o${i}` in variables; i++) {
    const node = known.get(`${variables[`o${i}`]}/${variables[`r${i}`]}#${variables[`n${i}`]}`)
    data[`p${i}`] = node ? { pullRequest: node } : null
    if (!node) errors.push({ type: 'NOT_FOUND', path: [`p${i}`], message: 'Could not resolve to a Repository' })
  }
  return errors.length > 0 ? { data, errors } : { data }
}

export const CHAT_REPLY = 'The share flow starts when onNewIntent hands the intent to takeShare.'

const MAIN_ACTIVITY = 'packages/mobile/android/app/src/main/java/ai/capy/MainActivity.kt'
const MODULE_KT = 'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt'
const PLUGIN = 'packages/mobile/plugins/with-share-extension.js'
const NATIVE = 'packages/mobile/modules/capy-share/index.ts'

export const aiGuide = {
  overview: {
    risk: { level: 'medium', reason: 'Every Android share now runs through CapyShareModule.takeShare, which no test exercises.' },
    synopsis:
      'Android hands shared intents to a new native module that stages the items. The share inbox reads them through the CapyShare bridge and the sheet uploads them to a thread. A config plugin registers the share extension at prebuild.'
  },
  caption: 'Shared content reaches a thread',
  sections: [
    {
      title: 'Build the share extension',
      summary: 'Prebuild registers the share extension plugin and Android share intents.',
      symbols: [`${PLUGIN}#withShareExtension`, `${PLUGIN}#addShareTarget`, `${PLUGIN}#withAndroidShareIntents`]
    },
    {
      title: 'Stage and upload shared files',
      summary: 'The native module stages shared content and exposes uploads to JavaScript.',
      symbols: [
        `${MAIN_ACTIVITY}#MainActivity.onNewIntent`,
        `${MODULE_KT}#CapyShareModule`,
        `${MODULE_KT}#CapyShareModule.takeShare`,
        `${MODULE_KT}#CapyShareModule.stageItems`,
        `${NATIVE}#CapyShare`,
        `${NATIVE}#CapyShareModule`
      ]
    },
    {
      title: 'Choose a thread and send',
      summary: 'The share inbox and sheet let the user pick a thread, then send uploads.',
      symbols: [
        'packages/mobile/src/share/share-inbox.tsx#ShareInbox',
        'packages/mobile/src/share/share-inbox.tsx#useSharedItems',
        'packages/mobile/src/share/share-sheet.tsx#ShareSheet',
        'packages/mobile/src/share/send.ts#useShareSend'
      ]
    }
  ],
  files: [
    {
      title: 'Release config',
      summary: 'The app config loads the plugin and the TestFlight script allows provisioning updates.',
      files: ['packages/mobile/app.config.ts', 'packages/mobile/scripts/testflight.sh']
    }
  ],
  questions: [
    'Can any app send an ACTION_SEND intent that MainActivity.onNewIntent passes to CapyShareModule.takeShare unchecked?',
    'What happens to ShareInbox.push when two share intents arrive before the inbox drains?',
    'Which test covers useShareSend when one CapyShare.upload call fails halfway through?'
  ]
}

function sse(res: ServerResponse, model: string, text: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_fixture',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 }
        }
      }
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]
  ]
  const words = text.split(/(?<= )/)
  for (const word of words) {
    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word } }])
  }
  events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }])
  events.push([
    'message_delta',
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: words.length } }
  ])
  events.push(['message_stop', { type: 'message_stop' }])
  for (const [event, data] of events) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  res.end()
}

export async function startAnthropic(): Promise<FixtureServer> {
  const requests: Recorded[] = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    const body = (await readBody(req)) as { model?: string; stream?: boolean; output_config?: { format?: unknown } } | null
    requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body })
    if (url.pathname !== '/v1/messages' || !body) return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'no route' } })

    const model = body.model ?? 'claude-opus-5-5'
    const text = body.output_config?.format ? JSON.stringify(aiGuide) : CHAT_REPLY
    if (body.stream) return sse(res, model, text)
    return json(res, 200, {
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 }
    })
  })
  return { url: await listen(server), requests, close: closer(server) }
}
