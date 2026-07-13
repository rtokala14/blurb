"use client"

import * as React from "react"
import {
  Calculator,
  Check,
  ClipboardCheck,
  HardHat,
  Ruler,
  Scale,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  BUILTIN_PERSONAS,
  PERSONA_DOMAINS,
  getBuiltinPersona,
  type Persona,
} from "@/lib/personas"
import { useOrbit } from "@/lib/store"
import { cn } from "@/lib/utils"

/** Persona icon name -> component (allow-listed in lib/personas). */
const ICONS: Record<string, LucideIcon> = {
  scale: Scale,
  "shield-check": ShieldCheck,
  "clipboard-check": ClipboardCheck,
  calculator: Calculator,
  "hard-hat": HardHat,
  ruler: Ruler,
  trophy: Trophy,
}

function PersonaIcon({ persona, className }: { persona: Persona; className?: string }) {
  const Icon = ICONS[persona.icon] ?? UserRound
  return <Icon className={className} />
}

/**
 * Persona picker for the chat header. Attaching a persona frames every turn
 * in the session; it's optional and orthogonal to document scope. Live mode
 * only — personas need the real agent.
 */
export function PersonaPicker({ sessionId }: { sessionId: string }) {
  const live = useOrbit((s) => s.live === true)
  const personaId = useOrbit(
    (s) => s.sessions.find((x) => x.id === sessionId)?.personaId ?? null
  )
  const setSessionPersona = useOrbit((s) => s.setSessionPersona)
  const active = getBuiltinPersona(personaId)

  if (!live) return null

  const grouped = BUILTIN_PERSONAS.reduce<Record<string, Persona[]>>((acc, p) => {
    ;(acc[p.domain] ??= []).push(p)
    return acc
  }, {})

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {active ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2"
                aria-label={`Persona: ${active.name}`}
              >
                <PersonaIcon persona={active} className="text-primary size-3.5" />
                <span className="max-w-32 truncate text-xs font-medium">
                  {active.name}
                </span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 gap-1.5 px-2"
                aria-label="Attach a persona"
              >
                <UserRound className="size-3.5" />
                <span className="text-xs max-sm:hidden">Persona</span>
              </Button>
            )}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {active
            ? `Answering as ${active.name}`
            : "Attach a discipline persona to frame answers"}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Persona
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground -mr-1 h-5 gap-1 px-1 text-xs font-normal"
              onClick={() => setSessionPersona(sessionId, null)}
            >
              <X className="size-3" /> Clear
            </Button>
          )}
        </DropdownMenuLabel>
        <p className="text-muted-foreground px-2 pb-1 text-xs">
          Frames how answers read — vocabulary, structure, what to flag. Your
          document scope is unchanged.
        </p>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto">
          {Object.entries(grouped).map(([domain, personas]) => (
            <React.Fragment key={domain}>
              <DropdownMenuLabel className="text-muted-foreground/70 text-[10px] font-medium tracking-wide uppercase">
                {PERSONA_DOMAINS[domain as Persona["domain"]]}
              </DropdownMenuLabel>
              {personas.map((persona) => (
                <DropdownMenuItem
                  key={persona.id}
                  className="items-start gap-2.5"
                  onClick={() => setSessionPersona(sessionId, persona.id)}
                >
                  <PersonaIcon
                    persona={persona}
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      persona.id === personaId
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{persona.name}</p>
                    <p className="text-muted-foreground text-xs leading-snug">
                      {persona.summary}
                    </p>
                  </div>
                  {persona.id === personaId && (
                    <Check className="text-primary mt-0.5 size-3.5 shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </React.Fragment>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Compact chip shown in the composer when a persona is attached. */
export function PersonaChip({ sessionId }: { sessionId: string }) {
  const personaId = useOrbit(
    (s) => s.sessions.find((x) => x.id === sessionId)?.personaId ?? null
  )
  const setSessionPersona = useOrbit((s) => s.setSessionPersona)
  const active = getBuiltinPersona(personaId)
  if (!active) return null
  return (
    <Badge variant="secondary" className="h-7 gap-1.5 pr-1 pl-2 font-normal">
      <PersonaIcon persona={active} className="text-primary size-3.5" />
      <span className="max-w-40 truncate text-xs">{active.name}</span>
      <button
        type="button"
        aria-label="Clear persona"
        className="hover:bg-background/60 rounded-full p-0.5"
        onClick={() => setSessionPersona(sessionId, null)}
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}
