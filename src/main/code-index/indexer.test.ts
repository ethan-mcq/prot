import { describe, expect, it } from 'vitest'
import { added, changed, pullWith } from '@shared/guide/fixtures'
import type { CodeSymbol } from '@shared/types'
import { indexPull, TreeSitter, type IndexSource } from './indexer'
import { grammarFiles } from './wasm'

const treeSitter = new TreeSitter(grammarFiles())

function source(files: Record<string, string>, tree: string[] = []): IndexSource {
  return {
    file: async (path, sha) => {
      const text = files[`${sha}:${path}`]
      if (text === undefined) throw new Error(`no ${sha}:${path}`)
      return text
    },
    tree: async () => tree
  }
}

function summary(symbols: CodeSymbol[]) {
  return symbols.map((s) => {
    const decorators = s.decorators.length > 0 ? ` @${s.decorators.join(' @')}` : ''
    return `${s.id} ${s.kind} ${s.change} ${s.head ? `${s.head.start}-${s.head.end}` : '-'}${decorators} -> ${s.calls.join(', ')}`
  })
}

const KT = 'app/src/main/java/ai/capy/share/CapyShareModule.kt'
const ktHead = `package ai.capy.share

class CapyShareModule : Module() {
  companion object {
    fun takeShare(intent: Intent) {
      val items = stageItems(intent)
      ShareInbox.push(items)
    }

    fun stageItems(intent: Intent): List<SharedItem> {
      return emptyList()
    }
  }

  @Test fun stagesNothing() {
    stageItems(Intent())
  }
}`

const TS = 'web/src/share/send.ts'
const tsHead = `import { CapyShare } from './native'

export type Item = { id: string }

export const MAX = 3

export function useShareSend() {
  return (items: Item[]) => items.slice(0, MAX).map((item) => CapyShare.upload(item.id))
}

describe('useShareSend', () => {
  it('caps uploads', () => {
    useShareSend()([])
  })
})

router.post('/share', useShareSend)`

const PY = 'pipeline/run.py'
const pyBase = `import click

def helper(x):
    return x
`
const pyHead = `import click

def helper(x):
    return x + 1

@click.command()
def cli():
    helper(1)

def test_helper():
    assert helper(1) == 2

if __name__ == "__main__":
    cli()
`

const NF = 'pipelines/nextflow/modules/local/align/main.nf'
const nfHead = `process ALIGN {
    input:
    path reads

    script:
    """
    bwa mem ref.fa \${reads} > out.sam
    """
}
`
const WORKFLOW = 'pipelines/nextflow/workflows/rnaseq.nf'
const workflowText = `include { ALIGN as MAP_READS } from '../modules/local/align/main'

workflow RNASEQ {
    MAP_READS(reads)
}
`

const TF = 'infra/main.tf'
const tfHead = `# logging
module "logs" {
  source    = "./modules/logs"
  retention = var.retention
}

variable "retention" {
  type    = number
  default = 30
}

resource "aws_s3_bucket" "audit" {
  bucket = "\${local.prefix}-audit"
  tags   = { name = "{" }
}

locals {
  prefix = "capy"
}
`

describe('indexPull', () => {
  it('parses Kotlin, TypeScript, Python, Nextflow and Terraform into symbols with ranges, changes and calls', async () => {
    const detail = pullWith([
      added(KT, ktHead.split('\n')),
      added(TS, tsHead.split('\n')),
      changed(PY, 'modified', [
        '@@ -2,3 +2,14 @@',
        ' ',
        ' def helper(x):',
        '-    return x',
        '+    return x + 1',
        '+',
        '+@click.command()',
        '+def cli():',
        '+    helper(1)',
        '+',
        '+def test_helper():',
        '+    assert helper(1) == 2',
        '+',
        '+if __name__ == "__main__":',
        '+    cli()'
      ]),
      added(NF, nfHead.trimEnd().split('\n')),
      added(TF, tfHead.trimEnd().split('\n'))
    ])
    const files = {
      [`head123:${KT}`]: ktHead,
      [`head123:${TS}`]: tsHead,
      [`head123:${PY}`]: pyHead,
      [`base000:${PY}`]: pyBase,
      [`head123:${NF}`]: nfHead,
      [`head123:${TF}`]: tfHead,
      [`head123:${WORKFLOW}`]: workflowText
    }
    const { index } = await indexPull(detail, source(files, [NF, WORKFLOW, 'pipelines/nextflow/main.nf']), treeSitter)
    expect(summary(index.symbols)).toEqual([
       'app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule class added 3-18 -> ',
       'app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule.takeShare method added 5-9 -> app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule.stageItems',
       'app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule.stageItems method added 10-12 -> ',
       'app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule › stagesNothing test added 15-17 @Test -> app/src/main/java/ai/capy/share/CapyShareModule.kt#CapyShareModule.stageItems',
       'app/src/main/java/ai/capy/share/CapyShareModule.kt#(module) module added 1-2 -> ',
       'web/src/share/send.ts#Item type added 3-4 -> ',
       'web/src/share/send.ts#MAX constant added 5-6 -> ',
       'web/src/share/send.ts#useShareSend function added 7-10 -> web/src/share/send.ts#Item, web/src/share/send.ts#MAX',
       'web/src/share/send.ts#useShareSend~2 test added 11-16 -> ',
       'web/src/share/send.ts#useShareSend › caps uploads test added 12-14 -> web/src/share/send.ts#useShareSend',
       'web/src/share/send.ts#POST /share function added 17-17 @router.post -> web/src/share/send.ts#useShareSend',
       'web/src/share/send.ts#(module) module added 1-2 -> ',
       'pipeline/run.py#helper function modified 3-5 -> ',
       'pipeline/run.py#cli function added 6-9 @click.command -> pipeline/run.py#helper',
       'pipeline/run.py#test_helper test added 10-12 -> pipeline/run.py#helper',
       'pipeline/run.py#__main__ function added 13-14 @__main__ -> pipeline/run.py#cli',
       'pipelines/nextflow/modules/local/align/main.nf#ALIGN function added 1-9 -> ',
       'infra/main.tf#module.logs class added 1-6 -> infra/main.tf#var.retention',
       'infra/main.tf#var.retention type added 7-11 -> ',
       'infra/main.tf#aws_s3_bucket.audit constant added 12-16 -> infra/main.tf#locals',
       'infra/main.tf#locals type added 17-19 -> ',
       'pipelines/nextflow/workflows/rnaseq.nf#RNASEQ function context 3-5 -> pipelines/nextflow/modules/local/align/main.nf#ALIGN'
    ])
  })
})
