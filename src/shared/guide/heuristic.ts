import type { Chapter, Guide, PullDetail } from '../types'
import { numberChapters, planChapters } from './chapters'
import { reviewFiles, type ReviewFile } from './files'
import { buildFlow, chapterIndex } from './flow'
import { overviewFor } from './overview'
import { declsByPath } from './symbols'

function inChapterOrder(files: ReviewFile[], chapters: Chapter[]): ReviewFile[] {
  const byPath = new Map<string, ReviewFile>()
  for (const file of files) byPath.set(file.path, file)
  const ordered: ReviewFile[] = []
  for (const chapter of chapters) {
    for (const path of chapter.files) {
      const file = byPath.get(path)
      if (file !== undefined) ordered.push(file)
    }
  }
  return ordered
}

export function buildHeuristicGuide(detail: PullDetail): Guide {
  const files = reviewFiles(detail.files)
  const decls = declsByPath(files)
  const chapters = numberChapters(planChapters(files, decls))
  return {
    source: 'heuristic',
    headSha: detail.head.sha,
    overview: overviewFor(detail, chapters, {}),
    flow: buildFlow(inChapterOrder(files, chapters), decls, chapterIndex(chapters)),
    chapters,
    symbols: {}
  }
}
