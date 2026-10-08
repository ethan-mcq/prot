import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentAttachments } from './attachments'
import { AgentFileAllowlist, agentFilePath, serveAgentFile } from './files'
import { extractImagePaths, imageSaver, withImages } from './images'
import { agentFileUrl } from '@shared/agents'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGPQ0DC4WR5OPMlAkmoNDQOGURtGbRgyNgAANMoTkMGIb4oAAAAASUVORK5CYII=', 'base64')

describe('agent images', () => {
  it('finds absolute image paths in markdown and bare text, and keeps only files that exist', () => {
    expect(extractImagePaths('See ![shot](/tmp/a.png) and /tmp/b.JPG, not tmp/c.png or /tmp/d.txt')).toEqual(['/tmp/a.png', '/tmp/b.JPG'])
    const event = withImages({ kind: 'assistant', id: 'a', at: 'x', text: 'Saved /tmp/a.png and /tmp/b.png' }, (path) => path === '/tmp/b.png')
    expect(event).toMatchObject({ images: ['/tmp/b.png'] })
  })

  it('serves only allowlisted real images', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prot-images-'))
    const saved = imageSaver(dir)('image/png', PNG.toString('base64')) ?? ''
    const fake = join(dir, 'fake.png')
    writeFileSync(fake, 'not a png')
    const allow = new AgentFileAllowlist()
    allow.allow([saved, fake, join(dir, 'x.txt')])
    expect(agentFilePath(agentFileUrl(saved))).toBe(saved)
    expect(agentFilePath('prot-agent-file://f/..%2Fetc%2Fpasswd')).toBeNull()
    const served = await serveAgentFile(agentFileUrl(saved), (path) => allow.has(path))
    expect([served.status, served.headers.get('content-type')]).toEqual([200, 'image/png'])
    expect((await serveAgentFile(agentFileUrl(fake), (path) => allow.has(path))).status).toBe(404)
    expect((await serveAgentFile(agentFileUrl(join(dir, 'other.png')), (path) => allow.has(path))).status).toBe(404)
  })

  it('refuses attachments from outside its folder', async () => {
    const store = new AgentAttachments(mkdtempSync(join(tmpdir(), 'prot-attach-')))
    const saved = await store.save('../shot.png', PNG)
    expect(saved).toMatchObject({ name: 'shot.png', mime: 'image/png', size: PNG.length })
    expect(await store.resolve([saved])).toEqual([saved])
    await expect(store.resolve([{ ...saved, path: '/etc/passwd' }])).rejects.toThrow('Attachments must come from prot')
  })
})
