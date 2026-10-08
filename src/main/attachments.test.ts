import { mkdtempSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attachmentLinks, webOrigin } from './attachment-links'
import { AttachmentService, protocolPath } from './attachments'
import { GitHubClient } from './github'

const SHA = 'a'.repeat(40)

describe('attachmentLinks', () => {
  it('finds images, videos and files on GitHub hosts in order, once each, with where they came from', () => {
    const description = [
      '<p>Before and after:</p>',
      '<a target="_blank" href="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&amp;x=1"><img src="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&amp;x=1" alt="Screenshot 2026-10-06"></a>',
      '<video src="https://github.com/user-attachments/assets/77-video" controls></video>',
      '<a href="https://github.com/user-attachments/files/123/build.log">build.log</a>',
      '<a href="https://example.com/docs">docs</a> <img src="https://cdn.example.com/badge.svg" alt="badge">',
      '<img src="https://avatars.githubusercontent.com/u/1" alt="avatar">'
    ].join('\n')
    const comment = [
      '<img src="https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=two" alt="again">',
      '<img src="https://camo.githubusercontent.com/abc123" alt="">',
      '<a href="https://github.com/capy-ai/capy/files/456/trace.zip">trace.zip</a>'
    ].join('\n')
    const markdownOnly = 'See ![crash](https://github.com/user-attachments/assets/99-crash) and ![x](https://example.com/x.png)'

    const links = attachmentLinks(
      [
        { source: 'description', html: description, markdown: '![ignored](https://github.com/user-attachments/assets/ignored)' },
        { source: 'comment by kai', html: comment, markdown: '' },
        { source: 'comment by ada', html: null, markdown: markdownOnly }
      ],
      'https://github.com'
    )

    expect(links).toEqual([
      { url: 'https://private-user-images.githubusercontent.com/1/2-uuid.png?jwt=one&x=1', name: 'Screenshot 2026-10-06', source: 'description' },
      { url: 'https://github.com/user-attachments/assets/77-video', name: '77-video', source: 'description' },
      { url: 'https://github.com/user-attachments/files/123/build.log', name: 'build.log', source: 'description' },
      { url: 'https://camo.githubusercontent.com/abc123', name: 'abc123', source: 'comment by kai' },
      { url: 'https://github.com/capy-ai/capy/files/456/trace.zip', name: 'trace.zip', source: 'comment by kai' },
      { url: 'https://github.com/user-attachments/assets/99-crash', name: 'crash', source: 'comment by ada' }
    ])
  })

  it('treats the GitHub Enterprise host as GitHub and github.com as a third party', () => {
    const web = webOrigin('https://ghe.acme.dev/api/v3')
    const html = '<img src="https://ghe.acme.dev/user-attachments/assets/1" alt="a"><img src="https://github.com/user-attachments/assets/2" alt="b">'
    expect({ web, links: attachmentLinks([{ source: 'description', html, markdown: '' }], web) }).toEqual({
      web: 'https://ghe.acme.dev',
      links: [{ url: 'https://ghe.acme.dev/user-attachments/assets/1', name: 'a', source: 'description' }]
    })
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
  it('stores what downloads, marks what fails, and on a retry fetches only the failed one', async () => {
    const requests: string[] = []
    const server = createServer((req, res) => {
      requests.push(`${req.url} ${req.headers.authorization ?? 'no token'}`)
      if (req.url === '/user-attachments/assets/shot') {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from([137, 80, 78, 71]))
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const root = mkdtempSync(join(tmpdir(), 'prot-attachments-'))
    let settled = () => {}
    const service = new AttachmentService(root, () => ({ authorization: 'Bearer t' }), () => settled())
    const ref = { owner: 'capy-ai', repo: 'capy', number: 5251 }
    const links = [
      { url: `${base}/user-attachments/assets/shot`, name: 'shot', source: 'description' },
      { url: `${base}/user-attachments/files/9/missing.log`, name: 'missing.log', source: 'comment by kai' }
    ]
    const run = () =>
      new Promise<void>((resolve) => {
        settled = resolve
        service.import(ref, links)
      })

    await run()
    const first = await service.list(ref)
    const firstRequests = requests.splice(0)
    await run()
    server.close()

    expect({ first, firstRequests, retried: requests, files: readdirSync(join(root, 'capy-ai__capy__5251')).sort() }).toEqual({
      first: [
        {
          url: `${base}/user-attachments/assets/shot`,
          name: 'shot',
          source: 'description',
          size: 4,
          kind: 'image',
          status: 'ready',
          src: expect.stringMatching(/^prot-attachment:\/\/pr\/capy-ai__capy__5251\/[0-9a-f]{40}\.png$/)
        },
        { url: `${base}/user-attachments/files/9/missing.log`, name: 'missing.log', source: 'comment by kai', size: null, kind: 'file', status: 'failed', src: null }
      ],
      firstRequests: ['/user-attachments/assets/shot Bearer t', '/user-attachments/files/9/missing.log Bearer t'],
      retried: ['/user-attachments/files/9/missing.log Bearer t'],
      files: [expect.stringMatching(/^[0-9a-f]{40}\.png$/), 'manifest.json']
    })
  })
})
