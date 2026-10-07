const OWNER = 'capy-ai'
const REPO = 'capy'
const NUMBER = 5251
const HEAD_SHA = '9f3c2a1b7e6d5c4b3a291807f6e5d4c3b2a19081'
const PUSHED_SHA = 'c41d7e09a2b84f6c1d3e5a7b9c0d2e4f6a8b0c1d'
const UPDATED_AT = '2026-10-06T09:30:00Z'
const PUSHED_AT = '2026-10-06T10:15:00Z'
const BASE_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f80912a3b4c5'

const author = { login: '0xluffyb', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' }
const viewer = { login: 'ethan-mcq', avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4' }

const appConfigPatch = `@@ -55,8 +55,9 @@ export default {
     ],
     ["expo-build-properties", { ios: { deploymentTarget: "16.4" } }],
     "./plugins/with-scene-lifecycle.js",
     "./plugins/with-screens-form-sheet.js",
     "./plugins/with-dev-menu-android.js",
+    "./plugins/with-share-extension.js",
   ],
 };
`

const pluginPatch = `@@ -0,0 +1,18 @@
+const { withXcodeProject, withAndroidManifest } = require("@expo/config-plugins");
+
+function withShareExtension(config) {
+  config = addShareTarget(config);
+  return withAndroidShareIntents(config);
+}
+
+function addShareTarget(config) {
+  return withXcodeProject(config, (mod) => mod);
+}
+
+function withAndroidShareIntents(config) {
+  return withAndroidManifest(config, (mod) => {
+    return mod;
+  });
+}
+
+module.exports = withShareExtension;
`

const mainActivityPatch = `@@ -20,6 +20,11 @@ class MainActivity : ReactActivity() {
     super.onCreate(null)
   }

+  override fun onNewIntent(intent: Intent) {
+    super.onNewIntent(intent)
+    CapyShareModule.takeShare(intent)
+  }
+
   override fun getMainComponentName(): String = "main"
 }
`

const moduleKtPatch = `@@ -0,0 +1,14 @@
+package ai.capy.share
+
+class CapyShareModule : Module() {
+  companion object {
+    fun takeShare(intent: Intent) {
+      val items = stageItems(intent)
+      ShareInbox.push(items)
+    }
+
+    fun stageItems(intent: Intent): List<SharedItem> {
+      return emptyList()
+    }
+  }
+}
`

const indexTsPatch = `@@ -0,0 +1,10 @@
+import { requireOptionalNativeModule } from "expo-modules-core";
+
+type CapyShareModule = {
+  readonly inExtension: boolean;
+  takeShare(): Promise<ReadonlyArray<NativeSharedItem>>;
+  upload(id: string, path: string, url: string, mediaType: string): Promise<void>;
+  cancelUploads(): void;
+};
+
+export const CapyShare = requireOptionalNativeModule<CapyShareModule>("CapyShare");
`

const shareInboxPatch = `@@ -0,0 +1,12 @@
+import { CapyShare } from "../../modules/capy-share";
+import { ShareSheet } from "./share-sheet";
+
+export function ShareInbox() {
+  const items = useSharedItems();
+  return <ShareSheet items={items} />;
+}
+
+function useSharedItems() {
+  return CapyShare?.takeShare();
+}
`

const shareSheetPatch = `@@ -0,0 +1,11 @@
+import { useShareSend } from "./send";
+
+export function ShareSheet({ items }: { items: SharedItem[] }) {
+  const send = useShareSend();
+  return (
+    <Sheet>
+      <ThreadPicker onPick={(thread) => send(thread, items)} />
+    </Sheet>
+  );
+}
+
`

const sendPatch = `@@ -0,0 +1,9 @@
+import { CapyShare } from "../../modules/capy-share";
+
+export function useShareSend() {
+  return async (threadId: string, items: SharedItem[]) => {
+    for (const item of items) {
+      await CapyShare?.upload(item.id, item.path, threadId, item.mediaType);
+    }
+  };
+}
`

const testflightPatch = `@@ -10,7 +10,8 @@ set -euo pipefail

 xcodebuild -exportArchive \\
   -archivePath build/Capy.xcarchive \\
-  -exportOptionsPlist ExportOptions.plist
+  -exportOptionsPlist ExportOptions.plist \\
+  -allowProvisioningUpdates

 echo "uploaded"
`

const readmePatch = `@@ -1,3 +1,5 @@
 # Capy mobile

-Run \`pnpm ios\`.
+Run \`pnpm ios\`.
+
+Sharing: use the share sheet from any app to send content to a thread.
`

const sendTestPatch = `@@ -0,0 +1,8 @@
+import { useShareSend } from "../src/share/send";
+
+test("uploads every shared item", async () => {
+  const send = useShareSend();
+  await send("thread-1", [item]);
+  expect(upload).toHaveBeenCalledTimes(1);
+});
+
`

const lockPatch = `@@ -100,6 +100,9 @@
     "expo-modules-core": "2.1.0",
+    "expo-share-intent": "3.0.0",
+    "@expo/config-plugins": "9.0.0",
+    "zod": "3.23.8",
     "react": "19.0.0",
`

function newFile(lines: string[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ''].join('\n')
}

const pushedModuleKtPatch = newFile([
  'package ai.capy.share',
  '',
  'import android.content.Intent',
  'import android.net.Uri',
  '',
  'class CapyShareModule : Module() {',
  '  companion object {',
  '    private val pending = mutableListOf<SharedItem>()',
  '',
  '    fun takeShare(intent: Intent) {',
  '      val items = stageItems(intent)',
  '      synchronized(pending) { pending.addAll(items) }',
  '      ShareInbox.push(items)',
  '    }',
  '',
  '    fun drain(): List<SharedItem> = synchronized(pending) {',
  '      val out = pending.toList()',
  '      pending.clear()',
  '      out',
  '    }',
  '',
  '    fun stageItems(intent: Intent): List<SharedItem> {',
  '      val uris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: return emptyList()',
  '      val type = intent.type ?: "application/octet-stream"',
  '      return uris.map { uri -> SharedItem(uri.toString(), type) }',
  '    }',
  '  }',
  '}'
])

const shareQueuePatch = newFile([
  'import { CapyShare } from "../../modules/capy-share";',
  '',
  'export type QueuedShare = {',
  '  id: string;',
  '  threadId: string;',
  '  path: string;',
  '  mediaType: string;',
  '  attempts: number;',
  '};',
  '',
  'const MAX_ATTEMPTS = 3;',
  'const queue: QueuedShare[] = [];',
  '',
  'export function enqueueShare(item: QueuedShare) {',
  '  queue.push(item);',
  '}',
  '',
  'export async function drainShareQueue() {',
  '  while (queue.length > 0) {',
  '    const item = queue[0];',
  '    try {',
  '      await CapyShare?.upload(item.id, item.path, item.threadId, item.mediaType);',
  '      queue.shift();',
  '    } catch {',
  '      item.attempts += 1;',
  '      if (item.attempts >= MAX_ATTEMPTS) queue.shift();',
  '      else break;',
  '    }',
  '  }',
  '}'
])

type FileFixture = {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
  previous_filename?: string
}

function counts(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

function file(filename: string, status: string, patch: string): FileFixture {
  return { filename, status, patch, ...counts(patch) }
}

const files: FileFixture[] = [
  file('packages/mobile/README.md', 'modified', readmePatch),
  file('packages/mobile/app.config.ts', 'modified', appConfigPatch),
  file('packages/mobile/plugins/with-share-extension.js', 'added', pluginPatch),
  file('packages/mobile/android/app/src/main/java/ai/capy/MainActivity.kt', 'modified', mainActivityPatch),
  file('packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt', 'added', moduleKtPatch),
  file('packages/mobile/modules/capy-share/index.ts', 'added', indexTsPatch),
  file('packages/mobile/src/share/share-inbox.tsx', 'added', shareInboxPatch),
  file('packages/mobile/src/share/share-sheet.tsx', 'added', shareSheetPatch),
  file('packages/mobile/src/share/send.ts', 'added', sendPatch),
  file('packages/mobile/scripts/testflight.sh', 'modified', testflightPatch),
  file('packages/mobile/__tests__/send.test.ts', 'added', sendTestPatch),
  file('pnpm-lock.yaml', 'modified', lockPatch),
  { filename: 'packages/mobile/assets/share-icon.png', status: 'added', additions: 0, deletions: 0 }
]

const fullFiles: Record<string, string> = {
  'packages/mobile/app.config.ts': [
    'export default {',
    ...Array.from({ length: 53 }, (_, i) => `  // config line ${i + 2}`),
    '    ],',
    '    ["expo-build-properties", { ios: { deploymentTarget: "16.4" } }],',
    '    "./plugins/with-scene-lifecycle.js",',
    '    "./plugins/with-screens-form-sheet.js",',
    '    "./plugins/with-dev-menu-android.js",',
    '    "./plugins/with-share-extension.js",',
    '  ],',
    '};',
    ''
  ].join('\n')
}

const MODULE_KT = 'packages/mobile/modules/capy-share/android/src/main/java/ai/capy/share/CapyShareModule.kt'

const pushedFiles: FileFixture[] = [
  ...files.map((f) => (f.filename === MODULE_KT ? file(MODULE_KT, 'added', pushedModuleKtPatch) : f)),
  file('packages/mobile/src/share/share-queue.ts', 'added', shareQueuePatch)
]

export type PullState = { headSha: string; updatedAt: string; files: FileFixture[] }

export const openedState: PullState = { headSha: HEAD_SHA, updatedAt: UPDATED_AT, files }
export const pushedState: PullState = { headSha: PUSHED_SHA, updatedAt: PUSHED_AT, files: pushedFiles }

const title = 'feat(mobile): share extension and Android share intent to a new or existing thread'
const body = `This PR adds mobile sharing so external content can be staged, uploaded, and sent to Capy threads on iOS and Android.

1. Prebuild the signed \`CapyShareExtension\` and register Android share intents.
2. Stage shared items and stream them through \`CapyShare\`.
3. Load shared session/context, choose a destination, then send.

<!-- reviewers: focus on the native module -->`

export const pull = {
  owner: OWNER,
  repo: REPO,
  number: NUMBER,
  title,
  headSha: HEAD_SHA
}

export const otherPull = {
  owner: 'ethan-mcq',
  repo: 'prot',
  number: 7,
  title: 'Add dark theme polish'
}

function searchItem(owner: string, repo: string, number: number, itemTitle: string, user: typeof author, updatedAt: string) {
  return {
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    number,
    title: itemTitle,
    user,
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    draft: false,
    created_at: '2026-10-05T17:00:00Z',
    updated_at: updatedAt,
    comments: 3,
    labels: [{ name: 'mobile', color: '0e8a16' }],
    pull_request: { url: `https://api.github.com/repos/${owner}/${repo}/pulls/${number}` }
  }
}

export function reviewSearch(state: PullState) {
  return {
    total_count: 1,
    incomplete_results: false,
    items: [searchItem(OWNER, REPO, NUMBER, title, author, state.updatedAt)]
  }
}

export const mineSearch = {
  total_count: 1,
  incomplete_results: false,
  items: [searchItem(otherPull.owner, otherPull.repo, otherPull.number, otherPull.title, viewer, UPDATED_AT)]
}

export const viewerUser = viewer

export function pullDetail(state: PullState) {
  return {
    number: NUMBER,
    title,
    body,
    user: author,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`,
    draft: false,
    created_at: '2026-10-05T17:00:00Z',
    updated_at: state.updatedAt,
    comments: 3,
    labels: [{ name: 'mobile', color: '0e8a16' }],
    additions: state.files.reduce((sum, f) => sum + f.additions, 0),
    deletions: state.files.reduce((sum, f) => sum + f.deletions, 0),
    changed_files: state.files.length,
    base: { ref: 'main', sha: BASE_SHA },
    head: { ref: 'luffy/share-extension', sha: state.headSha }
  }
}

const bugbot = { login: 'cursor[bot]', avatar_url: 'https://avatars.githubusercontent.com/in/1210556?v=4' }

const fixInCursorLinks = `<div><a href="https://cursor.com/open?link=abc" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-cursor-light.png"><img alt="Fix in Cursor" width="115" height="28" src="https://cursor.com/assets/images/fix-in-cursor-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/agents?link=def" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/fix-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/fix-in-web-light.png"><img alt="Fix in Web" width="99" height="28" src="https://cursor.com/assets/images/fix-in-web-dark.png"></picture></a></div>`

const homopolymerBugbot = `Homopolymer insertions at run edges clear
High Severity

<!-- DESCRIPTION START -->
An insertion is an artifact only when both flanking reference bases sit inside a homopolymer, but the check passes when either flank is in the run.

<!-- DESCRIPTION END --> <!-- BUGBOT_BUG_ID: 1ea0bae9-996e-4963-bf00-0f8925f7b16c --> <!-- LOCATIONS START packages/anomaly_interpretation/src/anomaly_interpretation/plasmid/enrichment/distinguishing_difference.py#L65-L73 LOCATIONS END --> ${fixInCursorLinks}
<sup>Reviewed by Cursor Bugbot for commit 937336e9207d72c9581e50b4dc8845db895d28ca. Configure here.</sup>`

const finalizeBugbot = `Finalize can bypass run failure hold
High Severity
<!-- DESCRIPTION START -->
The new run hold is applied after item finalize in \`SampleMarkComplete\`, and later completions on the same run still finalize. Because the hold can now fire while samples remain in progress, those items can still be packaged and delivered even though the run is held.
<!-- DESCRIPTION END --> <!-- BUGBOT_BUG_ID: 14a3193f-f954-4ec5-9136-65fb5ee2c7c1 --> <!-- LOCATIONS START website/api/sample.py#L715-L717 website/api/sample.py#L584-L713 LOCATIONS END --> <details> <summary>Additional Locations (1)</summary>

* \`website/api/sample.py#L584-L713\`

</details> ${fixInCursorLinks}
<sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit bdf0898950f1ea67b4b53bce93b569577990b65e. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>`

export const reviewComments = [
  {
    id: 9001,
    path: 'packages/mobile/src/share/send.ts',
    line: 6,
    side: 'RIGHT',
    body: 'Should uploads run in parallel?',
    user: { login: 'kai', avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4' },
    created_at: '2026-10-06T08:00:00Z',
    in_reply_to_id: null,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}#discussion_r9001`
  },
  {
    id: 9002,
    path: 'packages/mobile/src/share/send.ts',
    line: 4,
    side: 'RIGHT',
    body: homopolymerBugbot,
    user: bugbot,
    created_at: '2026-10-06T08:05:00Z',
    in_reply_to_id: null,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}#discussion_r9002`
  },
  {
    id: 9003,
    path: 'packages/mobile/src/share/send.ts',
    line: 7,
    side: 'RIGHT',
    body: finalizeBugbot,
    user: bugbot,
    created_at: '2026-10-06T08:06:00Z',
    in_reply_to_id: null,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}#discussion_r9003`
  }
]

export const reviews = [
  {
    id: 7001,
    user: { login: 'kai', avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4' },
    state: 'COMMENTED',
    body: '',
    submitted_at: '2026-10-06T08:00:00Z'
  }
]

export function fileContent(state: PullState, path: string): string | null {
  const full = fullFiles[path]
  if (full !== undefined) return full
  const match = state.files.find((f) => f.filename === path)
  if (!match?.patch) return null
  const lines: string[] = []
  for (const line of match.patch.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('-')) continue
    lines.push(line.slice(1))
  }
  return lines.join('\n')
}

export function tree(state: PullState): string[] {
  return [
    ...state.files.map((f) => f.filename),
    'packages/mobile/src/app.tsx',
    'packages/mobile/src/auth.ts',
    'packages/web/src/index.ts',
    'package.json'
  ]
}
