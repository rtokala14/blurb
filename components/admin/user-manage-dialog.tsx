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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { adminApi, type AdminUser } from "@/lib/live-api"

/** Per-user role + upload controls, plus a bonus-upload grant form (v3). */
export function UserManageDialog({
  user,
  onOpenChange,
  onSaved,
}: {
  user: AdminUser | null
  onOpenChange: (open: boolean) => void
  onSaved: (updated: AdminUser) => void
}) {
  const [role, setRole] = React.useState("user")
  const [isOnboarded, setIsOnboarded] = React.useState(false)
  const [isAllowedToUpload, setIsAllowedToUpload] = React.useState(false)
  const [dailyLimit, setDailyLimit] = React.useState(10)
  const [saving, setSaving] = React.useState(false)

  /* grant-bonus form */
  const [bonusAmount, setBonusAmount] = React.useState(10)
  const [validUntil, setValidUntil] = React.useState("")
  const [grantReason, setGrantReason] = React.useState("")
  const [granting, setGranting] = React.useState(false)

  React.useEffect(() => {
    if (user) {
      setRole(user.role || (user.isAdmin ? "admin" : "user"))
      setIsOnboarded(user.isOnboarded)
      setIsAllowedToUpload(user.isAllowedToUpload)
      setDailyLimit(user.dailyUploadLimit)
      // default the grant window to 30 days out
      const until = new Date(Date.now() + 30 * 24 * 3600 * 1000)
      setValidUntil(until.toISOString().slice(0, 10))
      setBonusAmount(10)
      setGrantReason("")
    }
  }, [user])

  if (!user) return null

  const save = async () => {
    setSaving(true)
    try {
      const result = await adminApi.updateUser(user.primaryKey, {
        role,
        isOnboarded,
        isAllowedToUpload,
        dailyUploadLimit: Math.max(0, Math.round(dailyLimit)),
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

  const grant = async () => {
    const amount = Math.max(1, Math.round(bonusAmount))
    if (!validUntil) {
      toast.error("Pick a valid-until date for the grant")
      return
    }
    setGranting(true)
    try {
      await adminApi.createGrant({
        userEmail: user.email,
        bonusUploads: amount,
        validUntil: new Date(`${validUntil}T23:59:59Z`).toISOString(),
        reason: grantReason.trim() || undefined,
      })
      toast.success("Bonus uploads granted", {
        description: `${amount} extra uploads for ${user.email} until ${validUntil}`,
      })
      setGrantReason("")
    } catch (error) {
      toast.error("Couldn't grant bonus uploads", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setGranting(false)
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
                Role
                <span className="text-muted-foreground block text-xs">
                  Admins get full console access and bypass upload limits
                </span>
              </span>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="flex items-center justify-between text-sm font-normal">
              <span>
                Onboarded
                <span className="text-muted-foreground block text-xs">
                  Whether the user has completed first-run onboarding
                </span>
              </span>
              <Switch checked={isOnboarded} onCheckedChange={setIsOnboarded} />
            </Label>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <Label className="flex items-center justify-between text-sm font-normal">
              <span>
                Allowed to upload
                <span className="text-muted-foreground block text-xs">
                  Users must be enabled before they can add documents
                </span>
              </span>
              <Switch
                checked={isAllowedToUpload}
                onCheckedChange={setIsAllowedToUpload}
              />
            </Label>
            {isAllowedToUpload && role !== "admin" && (
              <Label className="space-y-1.5 text-sm font-normal">
                <span>Daily upload limit</span>
                <Input
                  type="number"
                  min={0}
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                />
                <span className="text-muted-foreground block text-xs">
                  {user.uploadsUsedToday} used today
                  {user.activeBonusUploads > 0 &&
                    ` · +${user.activeBonusUploads} active bonus`}
                </span>
              </Label>
            )}
          </div>

          {/* Grant bonus uploads */}
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Grant bonus uploads</p>
            <div className="grid grid-cols-2 gap-3">
              <Label className="space-y-1.5 text-sm font-normal">
                <span>Amount</span>
                <Input
                  type="number"
                  min={1}
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(Number(e.target.value))}
                />
              </Label>
              <Label className="space-y-1.5 text-sm font-normal">
                <span>Valid until</span>
                <Input
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </Label>
            </div>
            <Label className="space-y-1.5 text-sm font-normal">
              <span>Reason (optional)</span>
              <Input
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="e.g. one-off migration batch"
              />
            </Label>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={granting}
              onClick={() => void grant()}
            >
              {granting ? "Granting…" : "Grant bonus uploads"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
