import { createContext, useContext, type Dispatch } from 'react'
import type { PullDetail } from '@shared/types'
import type { ReviewAction, ReviewSession } from './review-session'

export type Review = {
  detail: PullDetail
  session: ReviewSession
  dispatch: Dispatch<ReviewAction>
  loadFile: (path: string) => Promise<string>
  loadTree: () => Promise<string[]>
  refetch: () => void
}

export const ReviewContext = createContext<Review | null>(null)

export function useReview(): Review {
  const review = useContext(ReviewContext)
  if (!review) throw new Error('useReview outside ReviewContext')
  return review
}
