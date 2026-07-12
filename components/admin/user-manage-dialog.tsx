"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { adminApi, type AdminUser } from "@/lib/live-api"

/** Per-user flags + rate-limit controls (PoC admin user editor). */
export function UserManageDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null
  onOpenChange: (open: boolean) => void
  onSaved: (updated: AdminUser) => void
}) {
  const [isActive, setIsActive] = React.useState(true)
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [unlimited, setUnlimited] = React.useState(false)
  const [dailyLimit, setDailyLimit] = React.useState(10)
  const [bonus, setBonus] = React.useState(0)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (user) {
      setIsActive(user.isActive)
      setIsAdmin(user.isAdmin)
      setUnlimited(user.hasUnlimitedUploads)
      setDailyLimit(user.dailyUploadLimit)
      setBonus(user.bonusUploadLimit)
    }
  }, [user])

  if (!user) return null

  const save = async () => {
    setSaving(true)
    try {
      const result = await adminApi.updateUser(user.primaryKey, {
        isActive,
        isAdmin,
        hasUnlimitedUploads: unlimited,
        dailyUploadLimit: Math.max(0, Math.round(dailyLimit)),
        bonusUploadLimit: Math.max(0, Math.round(bonus)),
      })
      if (result.data) onSaved(result.data)
      toast("User updated", { description: user.email })
      onOpenChange(false)
    } catch (error) {
      toast.error("Couldn't update the user", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-3 rounded-lg border p-3">
            <Label className="flex items-center justify-between text-sm font-normal">
              <span>
                Active
                <span className="text-muted-foreground block text-xs">
                  Inactive users are rejected at sign-in
                </span>
              </span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </Label>
            <Label className="flex items-center justify-between text-sm font-normal">
              <span>
                Admin
                <span className="text-muted-foreground block text-xs">
                  Full access to this console; exempt from limits
                </span>
              </span>
              <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
            </Label>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <Label className="flex items-center justify-between text-sm font-normal">
              <span>
                Unlimited uploads
                <span className="text-muted-foreground block text-xs">
                  Bypass the daily upload quota entirely
                </span>
              </span>
              <Switch checked={unlimited} onCheckedChange={setUnlimited} />
            </Label>
            {!unlimited && !isAdmin && (
              <div className="grid grid-cols-2 gap-3">
                <Label className="space-y-1.5 text-sm font-normal">
                  <span>Daily upload limit</span>
                  <Input
                    type="number"
                    min={0}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                  />
                </Label>
                <Label className="space-y-1.5 text-sm font-normal">
                  <span>Bonus uploads</span>
                  <Input
                    type="number"
                    min={0}
                    value={bonus}
                    onChange={(e) => setBonus(Number(e.target.value))}
                  />
                </Label>
              </div>
            )}
            {!unlimited && !isAdmin && (
              <p className="text-muted-foreground text-xs">
                Effective limit today: {Math.max(0, Math.round(dailyLimit)) + Math.max(0, Math.round(bonus))} uploads
                · {user.uploadsUsedToday} already used
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
