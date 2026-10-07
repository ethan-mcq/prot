import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import * as pr from './share-pr'

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

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture')
    const body = await readBody(req)
    requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body })

    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return json(res, 401, { message: 'Bad credentials' })
    }

    const p = url.pathname
    if (p === '/user') return json(res, 200, pr.viewerUser)
    if (p === '/search/issues') {
      const q = url.searchParams.get('q') ?? ''
      if (q.includes('review-requested:@me')) return json(res, 200, pr.reviewSearch(state))
      if (q.includes('author:@me')) return json(res, 200, pr.mineSearch)
      return json(res, 200, { total_count: 0, items: [] })
    }
    if (p === `${prPath}/pulls/${pr.pull.number}`) return json(res, 200, pr.pullDetail(state))
    if (p === `${prPath}/pulls/${pr.pull.number}/files`) {
      const page = Number(url.searchParams.get('page') ?? '1')
      return json(res, 200, page === 1 ? state.files : [])
    }
    if (p === `${prPath}/pulls/${pr.pull.number}/comments`) return json(res, 200, pr.reviewComments)
    if (p === `${prPath}/pulls/${pr.pull.number}/reviews`) {
      if (req.method === 'POST') return json(res, 200, { id: 7002, state: 'APPROVED' })
      return json(res, 200, pr.reviews)
    }
    if (p === `${prPath}/issues/${pr.pull.number}/comments` && req.method === 'POST') {
      return json(res, 201, { id: 5001 })
    }
    if (p.startsWith(`${prPath}/contents/`)) {
      const path = decodeURIComponent(p.slice(`${prPath}/contents/`.length))
      const content = pr.fileContent(state, path)
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

  return {
    url: await listen(server),
    requests,
    close: closer(server),
    push: () => {
      state = pr.pushedState
    }
  }
}

export const CHAT_REPLY = 'The share flow starts when onNewIntent hands the intent to takeShare.'

export const aiGuide = {
  overview: {
    summary: 'Adds mobile sharing so external content reaches a Capy thread on iOS and Android.',
    points: [
      'Register the share extension and Android share intents.',
      'Stage shared items through the CapyShare native module.',
      'Pick a destination thread and upload.'
    ]
  },
  flow: {
    caption: 'Shared content reaches a thread',
    nodes: [
      { id: 'n1', label: 'MainActivity', file: 'packages/mobile/android/app/src/main/java/ai/capy/MainActivity.kt', change: 'context' },
      { id: 'n2', label: 'onNewIntent', file: 'packages/mobile/android/app/src/main/java/ai/capy/MainActivity.kt', change: 'added' },
      { id: 'n3', label: 'takeShare()', file: 'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt', change: 'added' },
      { id: 'n4', label: 'ShareInbox', file: 'packages/mobile/src/share/share-inbox.tsx', change: 'added' },
      { id: 'n5', label: 'ShareSheet', file: 'packages/mobile/src/share/share-sheet.tsx', change: 'added' },
      { id: 'n6', label: 'useShareSend()', file: 'packages/mobile/src/share/send.ts', change: 'added' }
    ],
    edges: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' }
    ]
  },
  chapters: [
    {
      title: 'Build the share extension',
      summary: 'Prebuild registers the share extension plugin and Android share intents.',
      files: ['packages/mobile/app.config.ts', 'packages/mobile/plugins/with-share-extension.js', 'packages/mobile/scripts/testflight.sh']
    },
    {
      title: 'Stage and upload shared files',
      summary: 'The native module stages shared content and exposes uploads to JavaScript.',
      files: [
        'packages/mobile/android/app/src/main/java/ai/capy/MainActivity.kt',
        'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt',
        'packages/mobile/modules/capy-share/index.ts'
      ]
    },
    {
      title: 'Choose a thread and send',
      summary: 'The share inbox and sheet let the user pick a thread, then send uploads.',
      files: ['packages/mobile/src/share/share-inbox.tsx', 'packages/mobile/src/share/share-sheet.tsx', 'packages/mobile/src/share/send.ts']
    }
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
