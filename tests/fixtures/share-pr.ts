const OWNER = 'capy-ai'
const REPO = 'capy'
const NUMBER = 5251
const HEAD_SHA = '9f3c2a1b7e6d5c4b3a291807f6e5d4c3b2a19081'
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

export const files: FileFixture[] = [
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

const additions = files.reduce((sum, f) => sum + f.additions, 0)
const deletions = files.reduce((sum, f) => sum + f.deletions, 0)

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

function searchItem(owner: string, repo: string, number: number, itemTitle: string, user: typeof author) {
  return {
    repository_url: `https://api.github.com/repos/${owner}/${repo}`,
    number,
    title: itemTitle,
    user,
    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
    draft: false,
    created_at: '2026-10-05T17:00:00Z',
    updated_at: '2026-10-06T09:30:00Z',
    comments: 3,
    labels: [{ name: 'mobile', color: '0e8a16' }],
    pull_request: { url: `https://api.github.com/repos/${owner}/${repo}/pulls/${number}` }
  }
}

export const reviewSearch = {
  total_count: 1,
  incomplete_results: false,
  items: [searchItem(OWNER, REPO, NUMBER, title, author)]
}

export const mineSearch = {
  total_count: 1,
  incomplete_results: false,
  items: [searchItem(otherPull.owner, otherPull.repo, otherPull.number, otherPull.title, viewer)]
}

export const viewerUser = viewer

export const pullDetail = {
  number: NUMBER,
  title,
  body,
  user: author,
  html_url: `https://github.com/${OWNER}/${REPO}/pull/${NUMBER}`,
  draft: false,
  created_at: '2026-10-05T17:00:00Z',
  updated_at: '2026-10-06T09:30:00Z',
  comments: 3,
  labels: [{ name: 'mobile', color: '0e8a16' }],
  additions,
  deletions,
  changed_files: files.length,
  base: { ref: 'main', sha: BASE_SHA },
  head: { ref: 'luffy/share-extension', sha: HEAD_SHA }
}

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

export function fileContent(path: string): string | null {
  const full = fullFiles[path]
  if (full !== undefined) return full
  const match = files.find((f) => f.filename === path)
  if (!match?.patch) return null
  const lines: string[] = []
  for (const line of match.patch.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('-')) continue
    lines.push(line.slice(1))
  }
  return lines.join('\n')
}

export const tree = [
  ...files.map((f) => f.filename),
  'packages/mobile/src/app.tsx',
  'packages/mobile/src/auth.ts',
  'packages/web/src/index.ts',
  'package.json'
]
