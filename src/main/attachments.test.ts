import { mkdtempSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attachmentLinks, webOrigin, type AttachmentLink } from './attachment-links'
import { AttachmentService, protocolPath } from './attachments'
import { GitHubClient } from './github'

const SHA = 'a'.repeat(40)

describe('attachmentLinks', () => {
  it('finds images, videos and files on GitHub hosts in order, once each', () => {
    const html = [
      '<p>Before and after:</p>',
      '<a target="_blank" href="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&amp;x=1"><img src="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&amp;x=1" alt="Screenshot 2026-10-06"></a>',
      '<video src="https://github.com/user-attachments/assets/77-video" controls></video>',
      '<a href="https://github.com/user-attachments/files/123/build.log">build.log</a>',
      '<a href="https://example.com/docs">docs</a> <img src="https://cdn.example.com/badge.svg" alt="badge">',
      '<img src="https://avatars.githubusercontent.com/u/1" alt="avatar">',
      '<img src="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=two" alt="again">',
      '<img src="https://camo.githubusercontent.com/abc123" alt="">',
      '<a href="https://github.com/capy-ai/capy/files/456/trace.zip">trace.zip</a>'
    ].join('\n')

    expect(attachmentLinks(html, '![ignored](https://github.com/user-attachments/assets/ignored)', 'https://github.com')).toEqual([
      { url: 'https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&x=1', name: 'Screenshot 2026-10-06' },
      { url: 'https://github.com/user-attachments/assets/77-video', name: '77-video' },
      { url: 'https://github.com/user-attachments/files/123/build.log', name: 'build.log' },
      { url: 'https://camo.githubusercontent.com/abc123', name: 'abc123' },
      { url: 'https://github.com/capy-ai/capy/files/456/trace.zip', name: 'trace.zip' }
    ])
  })

  it('reads the markdown when GitHub sent no rendering', () => {
    const markdown = 'See ![crash](https://github.com/user-attachments/assets/99-crash) and ![x](https://example.com/x.png)'
    expect(attachmentLinks(null, markdown, 'https://github.com')).toEqual([{ url: 'https://github.com/user-attachments/assets/99-crash', name: 'crash' }])
  })

  it('treats the GitHub Enterprise host as GitHub and github.com as a third party', () => {
    const web = webOrigin('https://ghe.acme.dev/api/v3')
    const html = '<img src="https://ghe.acme.dev/user-attachments/assets/1" alt="a"><img src="https://github.com/user-attachments/assets/2" alt="b">'
    expect({ web, links: attachmentLinks(html, '', web) }).toEqual({
      web: 'https://ghe.acme.dev',
      links: [{ url: 'https://ghe.acme.dev/user-attachments/assets/1', name: 'a' }]
    })
  })
})

describe('GitHubClient.getPull attachments', () => {
  async function pullServer(author: Record<string, string>) {
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const image = (name: string) => `![${name}](${base}/user-attachments/assets/${name})`
      const path = new URL(req.url ?? '/', base).pathname
      const routes: Record<string, unknown> = {
        '/repos/acme/app/pulls/1': {
          number: 1,
          state: 'open',
          merged_at: null,
          title: 'Retry uploads',
          body: `${image('sheet')}\n[run.log](${base}/user-attachments/files/9/run.log)`,
          ...((req.headers.accept ?? '').includes('full+json')
            ? { body_html: `<img src="${base}/user-attachments/assets/sheet" alt="sheet"><a href="${base}/user-attachments/files/9/run.log">run.log</a>` }
            : {}),
          user: { avatar_url: '', ...author },
          html_url: '',
          created_at: '',
          updated_at: '',
          comments: 2,
          labels: [],
          base: { ref: 'main', sha: 'b', repo: { full_name: 'acme/app', default_branch: 'main' } },
          head: { ref: 'retry', sha: 'h', repo: { full_name: 'acme/app' } },
          additions: 1,
          deletions: 0
        },
        '/repos/acme/app/pulls/1/files': [],
        '/repos/acme/app/pulls/1/comments': [
          { id: 5, path: 'a.ts', line: 1, side: 'RIGHT', body: image('review-comment'), user: { login: 'kai', avatar_url: '' }, created_at: '', html_url: '' }
        ],
        '/repos/acme/app/pulls/1/reviews': [{ id: 6, user: { login: 'kai', avatar_url: '' }, state: 'COMMENTED', body: image('review') }],
        '/repos/acme/app/issues/1/comments': [{ user: { login: 'kai', avatar_url: '' }, body: image('issue-comment') }]
      }
      res.writeHead(path in routes ? 200 : 404, { 'content-type': 'application/json' })
      res.end(JSON.stringify(routes[path] ?? { message: 'Not Found' }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  }

  it.each([
    ['a person, with images in a review comment, a review and an issue comment', { login: 'ada', type: 'User' }, ['sheet', 'run.log']],
    ['a Bot-type app', { login: 'renovate', type: 'Bot' }, []],
    ['a [bot] login', { login: 'cursor[bot]', type: 'User' }, []]
  ])('reads only the description written by %s', async (_case, author, names) => {
    const { server, base } = await pullServer(author)
    const { attachments } = await new GitHubClient('t', base).getPull({ owner: 'acme', repo: 'app', number: 1 }, 'viewer')
    server.close()
    const expected: Record<string, string> = { sheet: `${base}/user-attachments/assets/sheet`, 'run.log': `${base}/user-attachments/files/9/run.log` }
    expect(attachments).toEqual(names.map((name) => ({ url: expected[name], name })))
  })
})

describe('GitHubClient.attachmentHeaders', () => {
  it('sends the token to GitHub hosts only', () => {
    const client = new GitHubClient('ghp_secret', 'https://api.github.com')
    const sent = [
      'https://github.com/user-attachments/files/1/a.log',
      'https://api.github.com/repos/a/b',
      'https://private-user-images.githubusercontent.com/1/2.png?jwt=x',
      'https://github-production-user-asset.s3.amazonaws.com/1.png',
      'http://github.com/user-attachments/files/1/a.log'
    ].map((url) => [url, client.attachmentHeaders(new URL(url)).Authorization ?? null])
    expect(sent).toEqual([
      ['https://github.com/user-attachments/files/1/a.log', 'Bearer ghp_secret'],
      ['https://api.github.com/repos/a/b', 'Bearer ghp_secret'],
      ['https://private-user-images.githubusercontent.com/1/2.png?jwt=x', null],
      ['https://github-production-user-asset.s3.amazonaws.com/1.png', null],
      ['http://github.com/user-attachments/files/1/a.log', null]
    ])
  })
})

describe('protocolPath', () => {
  const root = '/tmp/prot/attachments'
  it.each([
    [`prot-attachment://pr/capy-ai__capy__5251/${SHA}.png`, `/tmp/prot/attachments/capy-ai__capy__5251/${SHA}.png`],
    [`prot-attachment://pr/capy-ai__capy__5251/${SHA}.txt`, null],
    [`prot-attachment://pr/capy-ai__capy__5251/..%2F..%2F${SHA}.png`, null],
    [`prot-attachment://pr/..%2Fguides/${SHA}.png`, null],
    [`prot-attachment://pr/%2e%2e/${SHA}.png`, null],
    [`prot-attachment://pr/../../etc/${SHA}.png`, null],
    [`prot-attachment://pr/capy-ai__capy__5251/sub/${SHA}.png`, null],
    [`prot-attachment://evil/capy-ai__capy__5251/${SHA}.png`, null],
    [`file:///tmp/prot/attachments/capy-ai__capy__5251/${SHA}.png`, null]
  ])('%s resolves to %s', (url, path) => {
    expect(protocolPath(root, url)).toBe(path)
  })
})

describe('AttachmentService import', () => {
  async function fileServer(requests: string[]) {
    const server = createServer((req, res) => {
      requests.push(`${req.url} ${req.headers.authorization ?? 'no token'}`)
      if (req.url === '/user-attachments/assets/shot') {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from([137, 80, 78, 71]))
      }
      if (req.url === '/user-attachments/files/9/run.log') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('ok\n')
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
  }

  function serviceIn(root: string) {
    let settled = () => {}
    const service = new AttachmentService(root, () => ({ authorization: 'Bearer t' }), () => settled())
    const run = (links: AttachmentLink[]) =>
      new Promise<void>((resolve) => {
        settled = resolve
        service.import(ref, links)
      })
    return { service, run }
  }

  const ref = { owner: 'capy-ai', repo: 'capy', number: 5251 }

  it('stores what downloads, marks what fails, and on a retry fetches only the failed one', async () => {
    const requests: string[] = []
    const { server, base } = await fileServer(requests)
    const root = mkdtempSync(join(tmpdir(), 'prot-attachments-'))
    const { service, run } = serviceIn(root)
    const links = [
      { url: `${base}/user-attachments/assets/shot`, name: 'shot' },
      { url: `${base}/user-attachments/files/9/missing.log`, name: 'missing.log' }
    ]

    await run(links)
    const first = await service.list(ref)
    const firstRequests = requests.splice(0)
    await run(links)
    server.close()

    expect({ first, firstRequests, retried: requests, files: readdirSync(join(root, 'capy-ai__capy__5251')).sort() }).toEqual({
      first: [
        {
          url: `${base}/user-attachments/assets/shot`,
          name: 'shot',
          size: 4,
          kind: 'image',
          status: 'ready',
          src: expect.stringMatching(/^prot-attachment:\/\/pr\/capy-ai__capy__5251\/[0-9a-f]{40}\.png$/)
        },
        { url: `${base}/user-attachments/files/9/missing.log`, name: 'missing.log', size: null, kind: 'file', status: 'failed', src: null }
      ],
      firstRequests: ['/user-attachments/assets/shot Bearer t', '/user-attachments/files/9/missing.log Bearer t'],
      retried: ['/user-attachments/files/9/missing.log Bearer t'],
      files: [expect.stringMatching(/^[0-9a-f]{40}\.png$/), 'manifest.json']
    })
  })

  it('deletes a stored attachment the next import no longer links, such as one from a comment', async () => {
    const { server, base } = await fileServer([])
    const root = mkdtempSync(join(tmpdir(), 'prot-attachments-'))
    const { service, run } = serviceIn(root)
    const shot = { url: `${base}/user-attachments/assets/shot`, name: 'shot' }
    const state = async () => ({
      items: (await service.list(ref)).map((item) => `${item.name} ${item.status}`),
      stored: readdirSync(join(root, 'capy-ai__capy__5251')).map((file) => extname(file)).sort()
    })

    await run([shot, { url: `${base}/user-attachments/files/9/run.log`, name: 'run.log' }])
    const before = await state()
    await run([shot])
    server.close()

    expect({ before, after: await state() }).toEqual({
      before: { items: ['shot ready', 'run.log ready'], stored: ['.json', '.log', '.png'] },
      after: { items: ['shot ready'], stored: ['.json', '.png'] }
    })
  })
})
