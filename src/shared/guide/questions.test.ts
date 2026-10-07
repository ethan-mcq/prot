import { describe, expect, it } from 'vitest'
import { added, capyStoryIndex, capyStoryPull, changed, codeSymbol, pullWith } from './fixtures'
import { buildHeuristicGuide, buildStoryGuide } from './index'

describe('predicted questions', () => {
  it('asks about callers, entry points and untested sections of the story, one rule at a time', () => {
    expect(buildStoryGuide(capyStoryPull, capyStoryIndex).questions).toEqual([
      'What else calls normalizeText, and does the change to it break them?',
      'Who can call MainActivity.onNewIntent, and does CapyShareModule.takeShare change what it returns or who is allowed?',
      'What covers normalizeText now that it has no tests in this PR?',
      'Who can call appendMessage, and does normalizeText change what it returns or who is allowed?'
    ])
  })

  it('asks whether a migration is safe on existing data', () => {
    const detail = pullWith([added('db/migrations/0042_shares.sql', ['alter table shares add column owner int;'])])
    expect(buildHeuristicGuide(detail).questions).toEqual([
      'Is the migration in db/migrations/0042_shares.sql safe to run on existing data?'
    ])
  })

  it('asks first whether a handler keeps its auth decorator', () => {
    const views = 'api/views.py'
    const purge = codeSymbol(views, 'purge', { kind: 'function', change: 'added', head: [12, 15] })
    const handler = codeSymbol(views, 'delete_share', {
      kind: 'function',
      change: 'modified',
      head: [4, 10],
      base: [4, 8],
      calls: [purge.id],
      decorators: ['app.post', 'login_required']
    })
    const detail = pullWith([changed(views, 'modified', ['@@ -4,5 +4,12 @@', ' def delete_share(id):', '+    purge(id)'])])
    expect(buildStoryGuide(detail, { headSha: 'head123', symbols: [handler, purge], skipped: [] }).questions).toEqual([
      'Does delete_share keep its @login_required check on every path?',
      'Who can call delete_share, and does purge change what it returns or who is allowed?',
      'What covers delete_share now that it has no tests in this PR?'
    ])
  })
})
