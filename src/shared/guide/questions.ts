import type { Chapter, CodeSymbol, StoryCard } from '../types'
import type { ReviewFile } from './files'
import { classifyFile } from './roles'

export const QUESTION_LIMIT = 5

export type QuestionInput = { files: ReviewFile[]; chapters: Chapter[]; symbols: Record<string, CodeSymbol> }

type QuestionRule = { ask: (input: QuestionInput) => string[] }

const AUTH_DECORATOR = /(^|\.)(\w+_required|requires_\w+|PreAuthorize|Secured|RolesAllowed)$/

function fullCards(chapter: Chapter, input: QuestionInput): { card: StoryCard; symbol: CodeSymbol }[] {
  const result: { card: StoryCard; symbol: CodeSymbol }[] = []
  for (const card of chapter.cards) {
    const symbol = input.symbols[card.symbolId]
    if (card.seeChapterId === null && symbol !== undefined) result.push({ card, symbol })
  }
  return result
}

function code(symbol: CodeSymbol): boolean {
  return symbol.kind !== 'module' && symbol.kind !== 'test' && classifyFile(symbol.path) !== 'test'
}

function hasCallers(symbol: CodeSymbol, input: QuestionInput): boolean {
  for (const other of Object.values(input.symbols)) {
    if (other.id !== symbol.id && code(other) && other.calls.includes(symbol.id)) return true
  }
  return false
}

function storySymbols(input: QuestionInput): CodeSymbol[] {
  const symbols: CodeSymbol[] = []
  for (const chapter of input.chapters) {
    for (const { symbol } of fullCards(chapter, input)) if (!symbols.includes(symbol)) symbols.push(symbol)
  }
  return symbols
}

// Priority order: a rule earlier in the table asks first.
export const QUESTION_RULES: QuestionRule[] = [
  {
    ask: (input) => {
      const questions: string[] = []
      for (const symbol of storySymbols(input)) {
        if (symbol.change === 'deleted') continue
        const decorator = symbol.decorators.find((name) => AUTH_DECORATOR.test(name))
        if (decorator !== undefined) questions.push(`Does ${symbol.qualifiedName} keep its @${decorator} check on every path?`)
      }
      return questions
    }
  },
  {
    ask: ({ files }) => {
      const questions: string[] = []
      for (const file of files) {
        if (file.role === 'schema') questions.push(`Is the migration in ${file.path} safe to run on existing data?`)
      }
      return questions
    }
  },
  {
    ask: (input) => {
      const questions: string[] = []
      for (const symbol of storySymbols(input)) {
        if ((symbol.change === 'modified' || symbol.change === 'deleted') && code(symbol) && hasCallers(symbol, input)) {
          questions.push(`What else calls ${symbol.qualifiedName}, and does the change to it break them?`)
        }
      }
      return questions
    }
  },
  {
    ask: (input) => {
      const questions: string[] = []
      for (const chapter of input.chapters) {
        const cards = fullCards(chapter, input)
        const entry = cards.find(({ card, symbol }) => card.role === 'entry' && symbol.change !== 'added' && symbol.change !== 'deleted')
        const steps = cards.filter(({ card, symbol }) => card.role !== 'entry' && symbol.change !== 'context' && code(symbol))
        const step = steps.find(({ symbol }) => symbol.kind === 'function' || symbol.kind === 'method') ?? steps[0]
        if (entry !== undefined && step !== undefined) {
          questions.push(
            `Who can call ${entry.symbol.qualifiedName}, and does ${step.symbol.qualifiedName} change what it returns or who is allowed?`
          )
        }
      }
      return questions
    }
  },
  {
    ask: (input) => {
      const questions: string[] = []
      for (const symbol of storySymbols(input)) {
        if (symbol.change === 'deleted' && code(symbol) && !hasCallers(symbol, input)) {
          questions.push(`Is ${symbol.qualifiedName} still referenced anywhere outside this PR?`)
        }
      }
      return questions
    }
  },
  {
    ask: (input) => {
      const questions: string[] = []
      for (const chapter of input.chapters) {
        const cards = fullCards(chapter, input)
        if (cards.some(({ card }) => card.role === 'test')) continue
        const root = cards.find(({ symbol }) => symbol.change !== 'context' && code(symbol) && classifyFile(symbol.path) === 'core')
        if (root !== undefined) questions.push(`What covers ${root.symbol.qualifiedName} now that it has no tests in this PR?`)
      }
      return questions
    }
  }
]

// Each rule's first question comes before any rule's second, so one busy rule cannot crowd out the rest.
export function predictQuestions(input: QuestionInput): string[] {
  const asked = QUESTION_RULES.map((rule) => rule.ask(input))
  const picked: string[] = []
  const deepest = Math.max(0, ...asked.map((questions) => questions.length))
  for (let round = 0; round < deepest; round++) {
    for (const questions of asked) {
      const question = questions[round]
      if (question !== undefined && !picked.includes(question) && picked.length < QUESTION_LIMIT) picked.push(question)
    }
  }
  return picked
}
