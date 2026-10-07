import type { ChangedFile, FileStatus, PullDetail } from '../types'

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

// Modeled on the Capy share-extension PR, in GitHub's alphabetical file order.
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
