import type { ChangedFile, CodeIndex, CodeSymbol, FileStatus, PullDetail } from '../types'

export function changed(
  path: string,
  status: FileStatus,
  patchLines: string[],
  counts?: { additions: number; deletions: number }
): ChangedFile {
  let additions = 0
  let deletions = 0
  for (const line of patchLines) {
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return {
    path,
    previousPath: null,
    status,
    additions: counts?.additions ?? additions,
    deletions: counts?.deletions ?? deletions,
    patch: patchLines.join('\n')
  }
}

export function added(path: string, source: string[]): ChangedFile {
  const lines = [`@@ -0,0 +1,${source.length} @@`]
  for (const line of source) lines.push(`+${line}`)
  return changed(path, 'added', lines)
}

export function pullWith(files: ChangedFile[], body = ''): PullDetail {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return {
    summary: {
      ref: { owner: 'capy', repo: 'capy', number: 812 },
      title: 'Share to Capy from other apps',
      author: { login: 'dev', avatarUrl: '' },
      url: 'https://github.com/capy/capy/pull/812',
      draft: false,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
      bucket: 'review',
      comments: 0,
      labels: []
    },
    body,
    base: { ref: 'main', sha: 'base000' },
    head: { ref: 'share-extension', sha: 'head123' },
    additions,
    deletions,
    files,
    reviewComments: [],
    reviews: []
  }
}

const MOBILE = 'packages/mobile'
export const KOTLIN_MODULE = `${MOBILE}/modules/capy-share/android/src/main/java/expo/modules/capyshare/CapyShareModule.kt`
export const SWIFT_MODULE = `${MOBILE}/modules/capy-share/ios/CapyShareModule.swift`
export const MAIN_ACTIVITY = `${MOBILE}/android/app/src/main/java/com/capy/app/MainActivity.kt`

export const capySharePull: PullDetail = pullWith(
  [
    changed(
      'package-lock.json',
      'modified',
      [
        '@@ -1200,2 +1200,3 @@',
        '       "dependencies": {',
        '+        "expo-share-intent": "^3.1.0",',
        '         "react": "18.3.1",'
      ],
      { additions: 48, deletions: 2 }
    ),
    changed(`${MOBILE}/README.md`, 'modified', [
      '@@ -40,3 +40,9 @@ Run the app with `npm run ios`.',
      ' ',
      ' ## Releasing',
      ' ',
      '+### Share extension',
      '+',
      '+The iOS share extension and the Android share intent are added by',
      '+`plugins/with-share-extension.js`. Rebuild native projects after changing it',
      '+with `npx expo prebuild --clean`.',
      '+'
    ]),
    changed(MAIN_ACTIVITY, 'modified', [
      '@@ -2,3 +2,5 @@ package com.capy.app',
      ' ',
      ' import android.os.Bundle',
      '+import android.content.Intent',
      '+import expo.modules.capyshare.takeShare',
      ' import com.facebook.react.ReactActivity',
      '@@ -12,3 +14,8 @@ class MainActivity : ReactActivity() {',
      '   override fun getMainComponentName(): String = "main"',
      '+',
      '+  override fun onNewIntent(intent: Intent) {',
      '+    super.onNewIntent(intent)',
      '+    takeShare(intent)',
      '+  }',
      ' ',
      '   override fun createReactActivityDelegate(): ReactActivityDelegate {'
    ]),
    changed(`${MOBILE}/app.config.ts`, 'modified', [
      '@@ -18,4 +18,5 @@ export default ({ config }: ConfigContext): ExpoConfig => ({',
      '   plugins: [',
      "     'expo-router',",
      "+    ['./plugins/with-share-extension', { appGroup: 'group.com.capy.app' }],",
      "     'expo-secure-store',",
      '   ],'
    ]),
    added(KOTLIN_MODULE, [
      'package expo.modules.capyshare',
      '',
      'import android.content.Intent',
      'import expo.modules.kotlin.modules.Module',
      'import expo.modules.kotlin.modules.ModuleDefinition',
      '',
      'private var pending: String? = null',
      '',
      'fun takeShare(intent: Intent?): String? {',
      '  if (intent?.action == Intent.ACTION_SEND) {',
      '    pending = intent.getStringExtra(Intent.EXTRA_TEXT)',
      '    return null',
      '  }',
      '  val text = pending',
      '  pending = null',
      '  return text',
      '}',
      '',
      'class CapyShareModule : Module() {',
      '  override fun definition() = ModuleDefinition {',
      '    Name("CapyShare")',
      '    Function("takeShare") { takeShare(null) }',
      '  }',
      '}'
    ]),
    added(SWIFT_MODULE, [
      'import ExpoModulesCore',
      '',
      'public class CapyShareModule: Module {',
      '  public func definition() -> ModuleDefinition {',
      '    Name("CapyShare")',
      '    Function("takeShare") { () -> String? in',
      '      let defaults = UserDefaults(suiteName: "group.com.capy.app")',
      '      let text = defaults?.string(forKey: "pendingShare")',
      '      defaults?.removeObject(forKey: "pendingShare")',
      '      return text',
      '    }',
      '  }',
      '}'
    ]),
    added(`${MOBILE}/plugins/with-share-extension.js`, [
      "const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins')",
      '',
      'function withShareExtension(config, { appGroup }) {',
      '  config = withInfoPlist(config, (mod) => {',
      '    mod.modResults.AppGroups = [appGroup]',
      '    return mod',
      '  })',
      '  return withAndroidManifest(config, (mod) => {',
      '    const activity = mod.modResults.manifest.application[0].activity[0]',
      "    activity['intent-filter'].push({",
      "      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],",
      "      data: [{ $: { 'android:mimeType': 'text/plain' } }],",
      '    })',
      '    return mod',
      '  })',
      '}',
      '',
      'module.exports = withShareExtension'
    ]),
    changed(`${MOBILE}/scripts/testflight.sh`, 'modified', [
      '@@ -8,2 +8,3 @@ set -euo pipefail',
      ' eas build --platform ios --profile production --non-interactive',
      '+eas build --platform ios --profile share-extension --non-interactive',
      ' eas submit --platform ios --latest'
    ]),
    changed(`${MOBILE}/src/chat/thread-store.ts`, 'modified', [
      '@@ -1,7 +1,8 @@',
      " import { api } from '../api'",
      "+import type { Thread } from './types'",
      ' ',
      ' export function appendMessage(threadId: string, text: string) {',
      '   return api.post(`/threads/${threadId}/messages`, { text })',
      ' }',
      ' ',
      ' export function openThread(threadId: string) {'
    ]),
    added(`${MOBILE}/src/share/__tests__/send.test.ts`, [
      "import { renderHook } from '@testing-library/react-native'",
      "import { appendMessage } from '../../chat/thread-store'",
      "import { useShareSend } from '../send'",
      '',
      "jest.mock('../../chat/thread-store')",
      '',
      "test('sends trimmed text to the thread', () => {",
      "  const { result } = renderHook(() => useShareSend('t1'))",
      "  result.current('  hello  ')",
      "  expect(appendMessage).toHaveBeenCalledWith('t1', 'hello')",
      '})'
    ]),
    added(`${MOBILE}/src/share/send.ts`, [
      "import { useCallback } from 'react'",
      "import { appendMessage } from '../chat/thread-store'",
      '',
      'export function useShareSend(threadId: string) {',
      '  return useCallback(',
      '    (text: string) => appendMessage(threadId, text.trim()),',
      '    [threadId],',
      '  )',
      '}'
    ]),
    added(`${MOBILE}/src/share/share-inbox.tsx`, [
      "import { useEffect, useState } from 'react'",
      "import CapyShare from '../../modules/capy-share'",
      "import { ShareSheet } from './share-sheet'",
      '',
      'export function ShareInbox({ threadId }: { threadId: string }) {',
      '  const [text, setText] = useState<string | null>(null)',
      '  useEffect(() => {',
      '    setText(CapyShare.takeShare())',
      '  }, [])',
      '  if (text === null) return null',
      '  return <ShareSheet text={text} threadId={threadId} />',
      '}'
    ]),
    added(`${MOBILE}/src/share/share-sheet.tsx`, [
      "import { useState } from 'react'",
      "import { Button, TextInput, View } from 'react-native'",
      "import { useShareSend } from './send'",
      '',
      'export function ShareSheet({ text, threadId }: { text: string; threadId: string }) {',
      '  const [draft, setDraft] = useState(text)',
      '  const send = useShareSend(threadId)',
      '  return (',
      '    <View>',
      '      <TextInput value={draft} onChangeText={setDraft} multiline />',
      '      <Button title="Send to thread" onPress={() => send(draft)} />',
      '    </View>',
      '  )',
      '}'
    ])
  ],
  [
    '<!-- Describe your change and link the issue -->',
    '## Summary',
    '',
    'Adds a **share extension** so people can share text from any app straight into a Capy thread.',
    'Android delivers the share through MainActivity, iOS through an app group.',
    '',
    '## Checklist',
    '- [x] Tested on device',
    '- [ ] Updated docs'
  ].join('\n')
)

const SHARE = `${MOBILE}/modules/capy-share`
export const STORY = {
  activity: `${MOBILE}/android/app/src/main/java/ai/capy/MainActivity.kt`,
  module: `${SHARE}/android/src/main/java/ai/capy/share/CapyShareModule.kt`,
  inboxKt: `${SHARE}/android/src/main/java/ai/capy/share/ShareInbox.kt`,
  native: `${SHARE}/index.ts`,
  inbox: `${MOBILE}/src/share/share-inbox.tsx`,
  sheet: `${MOBILE}/src/share/share-sheet.tsx`,
  send: `${MOBILE}/src/share/send.ts`,
  store: `${MOBILE}/src/chat/thread-store.ts`,
  sendTest: `${MOBILE}/src/share/__tests__/send.test.ts`,
  moduleTest: `${SHARE}/android/src/test/java/ai/capy/share/CapyShareModuleTest.kt`,
  dateTest: `${MOBILE}/src/format/__tests__/date.test.ts`,
  config: `${MOBILE}/app.config.ts`
}

export const STORY_HEADS: Record<string, string[]> = {
  [STORY.module]: [
    'package ai.capy.share',
    '',
    'import android.content.Intent',
    'import android.net.Uri',
    '',
    'const val MAX_SHARE_ITEMS = 20',
    '',
    'class CapyShareModule : Module() {',
    '  companion object {',
    '    fun takeShare(intent: Intent) {',
    '      val items = stageItems(intent)',
    '      ShareInbox.push(items)',
    '    }',
    '',
    '    fun stageItems(intent: Intent): List<SharedItem> {',
    '      val uris = readUris(intent).take(MAX_SHARE_ITEMS)',
    '      return uris.map { uri -> SharedItem(uri.toString(), mimeOf(intent)) }',
    '    }',
    '',
    '    private fun readUris(intent: Intent): List<Uri> =',
    '      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()',
    '',
    '    private fun mimeOf(intent: Intent): String = intent.type ?: "application/octet-stream"',
    '  }',
    '}',
    '',
    'data class SharedItem(val uri: String, val mimeType: String)'
  ],
  [STORY.inboxKt]: [
    'package ai.capy.share',
    '',
    'object ShareInbox {',
    '  private val items = mutableListOf<SharedItem>()',
    '',
    '  fun push(staged: List<SharedItem>) {',
    '    synchronized(items) { items.addAll(staged) }',
    '  }',
    '}'
  ],
  [STORY.native]: [
    'import { requireOptionalNativeModule } from "expo-modules-core";',
    '',
    'export type NativeSharedItem = { uri: string; mimeType: string };',
    '',
    'type CapyShareModule = {',
    '  takeShare(): Promise<ReadonlyArray<NativeSharedItem>>;',
    '  upload(id: string, caption: string, threadId: string): Promise<void>;',
    '};',
    '',
    'export const CapyShare = requireOptionalNativeModule<CapyShareModule>("CapyShare");'
  ],
  [STORY.inbox]: [
    'import { CapyShare } from "../../modules/capy-share";',
    'import { ShareSheet } from "./share-sheet";',
    '',
    'export function ShareInbox() {',
    '  const items = useSharedItems();',
    '  return <ShareSheet items={items} />;',
    '}',
    '',
    'function useSharedItems() {',
    '  return CapyShare?.takeShare() ?? [];',
    '}'
  ],
  [STORY.sheet]: [
    'import { useShareSend } from "./send";',
    '',
    'export function ShareSheet({ items }: { items: NativeSharedItem[] }) {',
    '  const send = useShareSend();',
    '  return <ThreadPicker onPick={(thread) => send(thread, items)} />;',
    '}'
  ],
  [STORY.send]: [
    'import { CapyShare } from "../../modules/capy-share";',
    'import { MAX_MESSAGE_LENGTH } from "../chat/thread-store";',
    '',
    'export function useShareSend() {',
    '  return async (threadId: string, items: NativeSharedItem[]) => {',
    '    const caption = items.map((item) => item.uri).join(" ").slice(0, MAX_MESSAGE_LENGTH);',
    '    for (const item of items) {',
    '      await CapyShare?.upload(item.uri, caption, threadId);',
    '    }',
    '  };',
    '}'
  ],
  [STORY.sendTest]: [
    'import { useShareSend } from "../send";',
    '',
    'test("uploads every shared item", async () => {',
    '  const send = useShareSend();',
    '  await send("thread-1", [{ uri: "a", mimeType: "text/plain" }]);',
    '});'
  ],
  [STORY.moduleTest]: [
    'package ai.capy.share',
    '',
    'class CapyShareModuleTest {',
    '  @Test fun stagesEveryUri() {',
    '    val items = CapyShareModule.stageItems(intentWith(2))',
    '    assertEquals(2, items.size)',
    '  }',
    '}'
  ],
  [STORY.dateTest]: [
    'import { formatDate } from "../date";',
    '',
    'test("formats today", () => {',
    '  expect(formatDate(new Date(0))).toBe("Jan 1");',
    '});'
  ]
}

function addedFrom(path: string): ChangedFile {
  return added(path, STORY_HEADS[path] ?? [])
}

export const capyStoryPull: PullDetail = pullWith(
  [
    changed(STORY.activity, 'modified', [
      '@@ -2,4 +2,5 @@ package ai.capy',
      ' ',
      ' import android.content.Intent',
      '+import ai.capy.share.CapyShareModule',
      ' ',
      ' class MainActivity : ReactActivity() {',
      '@@ -10,4 +11,5 @@ class MainActivity : ReactActivity() {',
      '   override fun onNewIntent(intent: Intent) {',
      '     super.onNewIntent(intent)',
      '+    CapyShareModule.takeShare(intent)',
      '   }',
      ' '
    ]),
    addedFrom(STORY.module),
    addedFrom(STORY.inboxKt),
    addedFrom(STORY.native),
    addedFrom(STORY.inbox),
    addedFrom(STORY.sheet),
    addedFrom(STORY.send),
    changed(STORY.store, 'modified', [
      '@@ -1,9 +1,11 @@',
      ' import { api } from "../api";',
      ' ',
      '+export const MAX_MESSAGE_LENGTH = 4000;',
      '+',
      ' export function appendMessage(threadId: string, text: string) {',
      '   return api.post(`/threads/${threadId}/messages`, { text: normalizeText(text) });',
      ' }',
      ' ',
      ' function normalizeText(text: string) {',
      '-  return text.trim();',
      '+  return text.replace(/\\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);',
      ' }'
    ]),
    addedFrom(STORY.sendTest),
    addedFrom(STORY.moduleTest),
    addedFrom(STORY.dateTest),
    changed(STORY.config, 'modified', [
      '@@ -18,4 +18,5 @@ export default ({ config }: ConfigContext): ExpoConfig => ({',
      '   plugins: [',
      "     'expo-router',",
      "+    ['./plugins/with-share-extension', { appGroup: 'group.com.capy.app' }],",
      "     'expo-secure-store',",
      '   ],'
    ])
  ],
  'Adds a share extension so people can share from any app straight into a Capy thread.'
)

type SymbolSpec = {
  kind: CodeSymbol['kind']
  change: CodeSymbol['change']
  head: [number, number] | null
  base?: [number, number] | null
  calls?: string[]
  callLines?: Record<string, number[]>
  parent?: string
  decorators?: string[]
}

export function codeSymbol(path: string, qualifiedName: string, spec: SymbolSpec): CodeSymbol {
  const range = (pair: [number, number] | null | undefined) => (pair ? { start: pair[0], end: pair[1] } : null)
  const calls = spec.calls ?? []
  const at = spec.head?.[0] ?? spec.base?.[0] ?? 1
  return {
    id: `${path}#${qualifiedName}`,
    path,
    name: qualifiedName.split(/\.| › /).at(-1) ?? qualifiedName,
    qualifiedName,
    kind: spec.kind,
    parentId: spec.parent === undefined ? null : `${path}#${spec.parent}`,
    head: range(spec.head),
    base: range(spec.base),
    change: spec.change,
    calls,
    callLines: spec.callLines ?? Object.fromEntries(calls.map((id) => [id, [at]])),
    decorators: spec.decorators ?? []
  }
}

const id = (path: string, name: string) => `${path}#${name}`
const S = STORY

export const capyStoryIndex: CodeIndex = {
  headSha: 'head123',
  skipped: [],
  symbols: [
    codeSymbol(S.activity, 'MainActivity', { kind: 'class', change: 'context', head: [6, 17], base: [5, 15] }),
    codeSymbol(S.activity, 'MainActivity.onCreate', { kind: 'method', change: 'context', head: [7, 10], base: [6, 9], parent: 'MainActivity' }),
    codeSymbol(S.activity, 'MainActivity.onNewIntent', {
      kind: 'method',
      change: 'modified',
      head: [11, 15],
      base: [10, 13],
      parent: 'MainActivity',
      calls: [id(S.module, 'CapyShareModule'), id(S.module, 'CapyShareModule.takeShare')],
      callLines: { [id(S.module, 'CapyShareModule')]: [13], [id(S.module, 'CapyShareModule.takeShare')]: [13] }
    }),
    codeSymbol(S.activity, 'MainActivity.getMainComponentName', { kind: 'method', change: 'context', head: [16, 16], base: [14, 14], parent: 'MainActivity' }),
    codeSymbol(S.activity, '(module)', { kind: 'module', change: 'modified', head: [4, 4], base: null, calls: [id(S.module, 'CapyShareModule')] }),

    codeSymbol(S.module, 'MAX_SHARE_ITEMS', { kind: 'constant', change: 'added', head: [6, 7] }),
    codeSymbol(S.module, 'CapyShareModule', { kind: 'class', change: 'added', head: [8, 26] }),
    codeSymbol(S.module, 'CapyShareModule.takeShare', {
      kind: 'method',
      change: 'added',
      head: [10, 14],
      parent: 'CapyShareModule',
      calls: [id(S.module, 'CapyShareModule.stageItems'), id(S.inboxKt, 'ShareInbox'), id(S.inboxKt, 'ShareInbox.push')]
    }),
    codeSymbol(S.module, 'CapyShareModule.stageItems', {
      kind: 'method',
      change: 'added',
      head: [15, 19],
      parent: 'CapyShareModule',
      calls: [
        id(S.module, 'CapyShareModule.readUris'),
        id(S.module, 'MAX_SHARE_ITEMS'),
        id(S.module, 'SharedItem'),
        id(S.module, 'CapyShareModule.mimeOf')
      ]
    }),
    codeSymbol(S.module, 'CapyShareModule.readUris', { kind: 'method', change: 'added', head: [20, 22], parent: 'CapyShareModule' }),
    codeSymbol(S.module, 'CapyShareModule.mimeOf', { kind: 'method', change: 'added', head: [23, 23], parent: 'CapyShareModule' }),
    codeSymbol(S.module, 'SharedItem', { kind: 'class', change: 'added', head: [27, 27] }),
    codeSymbol(S.module, '(module)', { kind: 'module', change: 'added', head: [1, 5] }),

    codeSymbol(S.inboxKt, 'ShareInbox', { kind: 'class', change: 'added', head: [3, 9], calls: [id(S.module, 'SharedItem')] }),
    codeSymbol(S.inboxKt, 'ShareInbox.push', { kind: 'method', change: 'added', head: [6, 8], parent: 'ShareInbox', calls: [id(S.module, 'SharedItem')] }),
    codeSymbol(S.inboxKt, '(module)', { kind: 'module', change: 'added', head: [1, 2] }),

    codeSymbol(S.native, 'NativeSharedItem', { kind: 'type', change: 'added', head: [3, 4] }),
    codeSymbol(S.native, 'CapyShareModule', { kind: 'type', change: 'added', head: [5, 9], calls: [id(S.native, 'NativeSharedItem')] }),
    codeSymbol(S.native, 'CapyShare', { kind: 'constant', change: 'added', head: [10, 10], calls: [id(S.native, 'CapyShareModule')] }),
    codeSymbol(S.native, '(module)', { kind: 'module', change: 'added', head: [1, 2] }),

    codeSymbol(S.inbox, 'ShareInbox', { kind: 'function', change: 'added', head: [4, 8], calls: [id(S.inbox, 'useSharedItems'), id(S.sheet, 'ShareSheet')] }),
    codeSymbol(S.inbox, 'useSharedItems', { kind: 'function', change: 'added', head: [9, 11], calls: [id(S.native, 'CapyShare')] }),
    codeSymbol(S.inbox, '(module)', { kind: 'module', change: 'added', head: [1, 3], calls: [id(S.native, 'CapyShare'), id(S.sheet, 'ShareSheet')] }),

    codeSymbol(S.sheet, 'ShareSheet', { kind: 'function', change: 'added', head: [3, 6], calls: [id(S.native, 'NativeSharedItem'), id(S.send, 'useShareSend')] }),
    codeSymbol(S.sheet, '(module)', { kind: 'module', change: 'added', head: [1, 2], calls: [id(S.send, 'useShareSend')] }),

    codeSymbol(S.send, 'useShareSend', {
      kind: 'function',
      change: 'added',
      head: [4, 11],
      calls: [id(S.native, 'NativeSharedItem'), id(S.store, 'MAX_MESSAGE_LENGTH'), id(S.native, 'CapyShare')]
    }),
    codeSymbol(S.send, '(module)', { kind: 'module', change: 'added', head: [1, 3], calls: [id(S.native, 'CapyShare'), id(S.store, 'MAX_MESSAGE_LENGTH')] }),

    codeSymbol(S.store, 'MAX_MESSAGE_LENGTH', { kind: 'constant', change: 'added', head: [3, 4] }),
    codeSymbol(S.store, 'appendMessage', {
      kind: 'function',
      change: 'context',
      head: [5, 8],
      base: [3, 6],
      calls: [id(S.store, 'normalizeText')],
      callLines: { [id(S.store, 'normalizeText')]: [6] }
    }),
    codeSymbol(S.store, 'normalizeText', {
      kind: 'function',
      change: 'modified',
      head: [9, 11],
      base: [7, 9],
      calls: [id(S.store, 'MAX_MESSAGE_LENGTH')],
      callLines: { [id(S.store, 'MAX_MESSAGE_LENGTH')]: [10] }
    }),

    codeSymbol(S.sendTest, 'uploads every shared item', { kind: 'test', change: 'added', head: [3, 6], calls: [id(S.send, 'useShareSend')] }),
    codeSymbol(S.sendTest, '(module)', { kind: 'module', change: 'added', head: [1, 2], calls: [id(S.send, 'useShareSend')] }),

    codeSymbol(S.moduleTest, 'CapyShareModuleTest', { kind: 'class', change: 'added', head: [3, 8] }),
    codeSymbol(S.moduleTest, 'CapyShareModuleTest › stagesEveryUri', {
      kind: 'test',
      change: 'added',
      head: [4, 7],
      parent: 'CapyShareModuleTest',
      decorators: ['Test'],
      calls: [id(S.module, 'CapyShareModule'), id(S.module, 'CapyShareModule.stageItems')]
    }),
    codeSymbol(S.moduleTest, '(module)', { kind: 'module', change: 'added', head: [1, 2] }),

    codeSymbol(S.dateTest, 'formats today', { kind: 'test', change: 'added', head: [3, 5] }),
    codeSymbol(S.dateTest, '(module)', { kind: 'module', change: 'added', head: [1, 2] })
  ]
}
