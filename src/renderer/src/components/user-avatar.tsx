import type { GitHubUser } from '@shared/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export function UserAvatar({ user, className }: { user: GitHubUser; className?: string }) {
  return (
    <Avatar className={cn('size-5', className)}>
      <AvatarImage src={user.avatarUrl} alt="" />
      <AvatarFallback className="text-[10px] font-medium uppercase">{user.login.slice(0, 2)}</AvatarFallback>
    </Avatar>
  )
}
