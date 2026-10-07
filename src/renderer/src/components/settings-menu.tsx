import { useState } from 'react'
import { FileText, LogOut, Settings as SettingsIcon } from 'lucide-react'
import type { Theme } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PaneButton } from '@/components/pane'
import { PromptDialog } from '@/components/prompt-dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/utils'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const POLL_OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 30, label: 'Every 30 seconds' },
  { seconds: 60, label: 'Every minute' },
  { seconds: 120, label: 'Every 2 minutes' },
  { seconds: 300, label: 'Every 5 minutes' },
  { seconds: 900, label: 'Every 15 minutes' }
]

export function SettingsMenu({ onSignOut }: { onSignOut: () => void }) {
  const { settings, updateSettings } = usePrefs()
  const [open, setOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <PaneButton aria-label="Settings">
            <SettingsIcon />
          </PaneButton>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" collisionPadding={10} className="w-80 space-y-4 p-4">
          <div className="space-y-2">
            <p className="font-mono text-[11.5px] text-muted-foreground">theme</p>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 rounded-[8px] bg-muted p-0.5">
              {THEMES.map((theme) => (
                <button
                  key={theme.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === theme.value}
                  onClick={() => void updateSettings({ theme: theme.value })}
                  className={cn(
                    'rounded-[6px] py-1 text-xs transition-colors',
                    settings.theme === theme.value
                      ? 'bg-card font-medium shadow-raised'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {theme.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[11.5px] text-muted-foreground">check for pull requests</p>
            <Select
              value={String(settings.pollSeconds)}
              onValueChange={(value) => void updateSettings({ pollSeconds: Number(value) })}
            >
              <SelectTrigger aria-label="Check for pull requests" className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLL_OPTIONS.map((option) => (
                  <SelectItem key={option.seconds} value={String(option.seconds)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <SettingSwitch
            id="notify"
            label="Notifications"
            hint="When a review is requested from you"
            checked={settings.notify}
            onChange={(notify) => void updateSettings({ notify })}
          />
          <SettingSwitch
            id="auto-ai"
            label="AI guide automatically"
            hint="Write an AI guide when you open a pull request"
            checked={settings.autoAiGuide}
            onChange={(autoAiGuide) => void updateSettings({ autoAiGuide })}
          />
          <SettingSwitch
            id="auto-refresh-stale"
            label="Refresh stale AI guides automatically"
            hint="Rewrite the AI guide when a push leaves it far out of date"
            checked={settings.autoRefreshStaleGuides}
            onChange={(autoRefreshStaleGuides) => void updateSettings({ autoRefreshStaleGuides })}
          />
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false)
              setPromptOpen(true)
            }}
          >
            <FileText /> Review prompt…
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={onSignOut}>
            <LogOut /> Sign out
          </Button>
        </PopoverContent>
      </Popover>
      <PromptDialog open={promptOpen} onOpenChange={setPromptOpen} />
    </>
  )
}

function SettingSwitch({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
