import type { FileRole } from '../types'

type RoleRule = {
  role: FileRole
  names?: string[]
  extensions?: string[]
  dirs?: string[]
  patterns?: RegExp[]
}

const RULES: RoleRule[] = [
  {
    role: 'deps',
    names: [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
      'cargo.lock',
      'poetry.lock',
      'uv.lock',
      'pipfile.lock',
      'go.sum',
      'gemfile.lock',
      'podfile.lock',
      'composer.lock',
      'flake.lock',
      'mix.lock',
      'gradle.lockfile',
      'packages.lock.json'
    ]
  },
  {
    role: 'generated',
    dirs: ['dist', 'build', '__generated__', 'generated', '__snapshots__'],
    extensions: ['.snap', '.pb.go', '.map'],
    patterns: [/\.generated\.[^/]+$/i, /_pb2(_grpc)?\.pyi?$/, /\.min\.(js|css)$/i, /\.g\.dart$/]
  },
  {
    role: 'test',
    dirs: ['__tests__', '__mocks__', 'test', 'tests', 'spec', 'specs', 'e2e', 'androidtest', 'testdata'],
    patterns: [
      /\.(test|spec)\.[^/]+$/i,
      /_test\.go$/,
      /(^|\/)test_[^/]*\.py$/,
      /_test\.py$/,
      /[a-z0-9](Test|Tests|Spec)\.(kt|java|swift|scala)$/
    ]
  },
  {
    role: 'schema',
    dirs: ['migrations', 'migration'],
    extensions: ['.sql', '.prisma'],
    patterns: [/(^|\/)alembic\/versions\//, /(^|\/)schema\.(graphql|gql)$/i, /(^|\/)db\/schema\.rb$/]
  },
  {
    role: 'build',
    names: [
      'makefile',
      'gnumakefile',
      'cmakelists.txt',
      'setup.py',
      'setup.cfg',
      'pyproject.toml',
      'package.json',
      'cargo.toml',
      'go.mod',
      'gemfile',
      'podfile',
      'pipfile',
      'justfile',
      'rakefile',
      'build.sbt',
      'pom.xml',
      'gradle.properties',
      'gradlew',
      'gradlew.bat',
      'build.bazel',
      'meson.build'
    ],
    extensions: ['.gradle', '.gradle.kts', '.podspec', '.sh', '.bash', '.zsh', '.cmake', '.mk', '.bzl'],
    patterns: [/(^|\/)requirements[^/]*\.txt$/i]
  },
  {
    role: 'assets',
    extensions: [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.avif',
      '.ico',
      '.icns',
      '.bmp',
      '.svg',
      '.ttf',
      '.otf',
      '.woff',
      '.woff2',
      '.eot',
      '.mp3',
      '.mp4',
      '.wav',
      '.mov',
      '.webm'
    ]
  },
  {
    role: 'docs',
    names: ['license', 'licence', 'changelog', 'authors', 'contributing', 'notice'],
    extensions: ['.md', '.mdx', '.rst', '.txt', '.adoc'],
    dirs: ['docs', 'doc']
  },
  {
    role: 'config',
    names: ['dockerfile', 'procfile', 'codeowners', 'androidmanifest.xml'],
    extensions: [
      '.json',
      '.jsonc',
      '.json5',
      '.yaml',
      '.yml',
      '.toml',
      '.ini',
      '.cfg',
      '.conf',
      '.env',
      '.properties',
      '.plist',
      '.xcconfig',
      '.entitlements'
    ],
    patterns: [/(^|\/)\.[^/]+/, /(^|\/)dockerfile[^/]*$/i, /\.config\.[^/.]+$/i]
  },
  {
    role: 'ui',
    extensions: ['.tsx', '.jsx', '.vue', '.svelte', '.astro', '.css', '.scss', '.sass', '.less', '.html', '.htm']
  }
]

function matches(rule: RoleRule, path: string, lowerPath: string): boolean {
  const segments = lowerPath.split('/')
  const base = segments[segments.length - 1] ?? lowerPath
  if (rule.names?.includes(base)) return true
  if (rule.extensions) {
    for (const extension of rule.extensions) {
      if (base.endsWith(extension)) return true
    }
  }
  if (rule.dirs) {
    for (const dir of segments.slice(0, -1)) {
      if (rule.dirs.includes(dir)) return true
    }
  }
  if (rule.patterns) {
    for (const pattern of rule.patterns) {
      if (pattern.test(path)) return true
    }
  }
  return false
}

export function classifyFile(path: string): FileRole {
  const lowerPath = path.toLowerCase()
  for (const rule of RULES) {
    if (matches(rule, path, lowerPath)) return rule.role
  }
  return 'core'
}
