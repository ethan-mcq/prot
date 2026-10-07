import { useId } from 'react'
import { cn } from '@/lib/utils'

export function Logo({ className, tile = true }: { className?: string; tile?: boolean }) {
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" className={cn('size-7', className)} aria-label="prot">
      <defs>
        <clipPath id={`${id}l`}>
          <ellipse cx="27.5" cy="31" rx="4.6" ry="6.4" />
        </clipPath>
        <clipPath id={`${id}r`}>
          <ellipse cx="36.9" cy="31" rx="4.6" ry="6.4" />
        </clipPath>
      </defs>
      {tile && <rect x="1" y="1" width="62" height="62" rx="15" fill="#fff" stroke="#e7e7e5" strokeWidth="1" />}
      <circle cx="32" cy="32" r={tile ? 21 : 31} fill="#0b0b0b" />
      <ellipse cx="27.5" cy="31" rx="4.6" ry="6.4" fill="#fff" />
      <ellipse cx="36.9" cy="31" rx="4.6" ry="6.4" fill="#fff" />
      <g clipPath={`url(#${id}l)`}>
        <circle cx="25.4" cy="33" r="2.7" fill="#0b0b0b" />
        <circle cx="24.6" cy="32" r="0.7" fill="#fff" />
      </g>
      <g clipPath={`url(#${id}r)`}>
        <circle cx="34.8" cy="33" r="2.7" fill="#0b0b0b" />
        <circle cx="34" cy="32" r="0.7" fill="#fff" />
      </g>
    </svg>
  )
}
