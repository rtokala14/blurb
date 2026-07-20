"use client"

import * as React from "react"
import {
  Check,
  Ruler,
  Scale,
  UserRound,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BUILTIN_PERSONAS, type Persona } from "@/lib/personas"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"

/** Persona icon name -> component (allow-listed in lib/personas). */
const PERSONA_ICONS: Record<string, LucideIcon> = {
  scale: Scale,
  ruler: Ruler,
}

function PersonaIcon({ persona, className }: { persona: Persona; className?: string }) {
  const Icon = PERSONA_ICONS[persona.icon] ?? UserRound
  return <Icon className={className} />
}

/**
 * Profile & preferences. Everything here is per-user and lives in
 * localStorage for now (see lib/user-profile.ts) — no server round-trip.
 * The chosen persona and instructions frame how the assistant responds.
 */
export function SettingsView() {
  const profile = useOrbit((s) => s.userProfile)
  const setUserProfile = useOrbit((s) => s.setUserProfile)

  // Local draft so typing feels instant; committed on Save.
  const [displayName, setDisplayName] = React.useState(profile.displayName)
  const [customInstructions, setCustomInstructions] = React.useState(
    profile.customInstructions
  )
  const [personaId, setPersonaId] = React.useState<string | null>(profile.personaId)

  // Re-sync the draft when the store hydrates from localStorage on mount.
  const [hydratedFrom, setHydratedFrom] = React.useState(profile)
  if (profile !== hydratedFrom) {
    setHydratedFrom(profile)
    setDisplayName(profile.displayName)
    setCustomInstructions(profile.customInstructions)
    setPersonaId(profile.personaId)
  }

  const dirty =
    displayName !== profile.displayName ||
    customInstructions !== profile.customInstructions ||
    personaId !== profile.personaId

  const save = () => {
    setUserProfile({ displayName, customInstructions, personaId })
    toast.success("Preferences saved")
  }

  const reset = () => {
    setDisplayName(profile.displayName)
    setCustomInstructions(profile.customInstructions)
    setPersonaId(profile.personaId)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold">Profile &amp; preferences</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Tell the assistant how you&apos;d like it to respond. These
            preferences apply across every chat and are stored on this device.
          </p>
        </div>

        {/* About you */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">About you</CardTitle>
            <CardDescription>
              Optional — used to personalize how the assistant addresses you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="display-name">What should we call you?</Label>
              <Input
                id="display-name"
                placeholder="e.g. Rohit, or Dr. Tokala"
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-instructions">
                How would you like the assistant to respond?
              </Label>
              <Textarea
                id="custom-instructions"
                placeholder="e.g. Be concise and lead with the answer. Prefer tables for comparisons. Flag anything the documents don't support."
                rows={4}
                maxLength={2000}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="resize-none"
              />
              <p className="text-muted-foreground text-xs">
                Free-form guidance on tone, structure, and priorities.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Persona */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Persona</CardTitle>
            <CardDescription>
              Pick a discipline lens to frame how answers read — vocabulary,
              structure, and what to flag. Your document scope is unchanged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <PersonaOption
              selected={personaId === null}
              onSelect={() => setPersonaId(null)}
              icon={<UserRound className="size-4" />}
              name="No persona"
              summary="Default assistant — no discipline framing."
            />
            {BUILTIN_PERSONAS.map((persona) => (
              <PersonaOption
                key={persona.id}
                selected={personaId === persona.id}
                onSelect={() => setPersonaId(persona.id)}
                icon={<PersonaIcon persona={persona} className="size-4" />}
                name={persona.name}
                summary={persona.summary}
              />
            ))}
          </CardContent>
        </Card>

        {/* Save bar */}
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <Button variant="ghost" onClick={reset}>
              Discard
            </Button>
          )}
          <Button onClick={save} disabled={!dirty}>
            Save preferences
          </Button>
        </div>
      </div>
    </div>
  )
}

function PersonaOption({
  selected,
  onSelect,
  icon,
  name,
  summary,
}: {
  selected: boolean
  onSelect: () => void
  icon: React.ReactNode
  name: string
  summary: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "hover:bg-accent flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        selected && "border-primary/50 bg-primary/5"
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          selected ? "text-primary" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{name}</span>
        <span className="text-muted-foreground block text-xs leading-snug">
          {summary}
        </span>
      </span>
      {selected && <Check className="text-primary mt-0.5 size-4 shrink-0" />}
    </button>
  )
}
