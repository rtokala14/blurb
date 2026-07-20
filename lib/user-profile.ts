/**
 * Per-user profile & preferences — how the user wants the assistant to respond.
 * As of the persona rework this is a per-user concern (set once in Settings),
 * not a per-chat one, and it lives entirely in localStorage for now: the
 * Foundry rewrite will own the persisted version. Pure/SSR-safe helpers only,
 * so this can be imported anywhere.
 */

export interface UserProfile {
  /** what the assistant should call the user (optional) */
  displayName: string
  /** free-form "this is how I want you to respond" instructions (optional) */
  customInstructions: string
  /** selected built-in persona id, or null for none */
  personaId: string | null
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: "",
  customInstructions: "",
  personaId: null,
}

const STORAGE_KEY = "orbit.user-profile"

/** Read the saved profile (default on the server / when nothing is stored). */
export function readUserProfile(): UserProfile {
  if (typeof window === "undefined") return DEFAULT_USER_PROFILE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_USER_PROFILE
    return { ...DEFAULT_USER_PROFILE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_USER_PROFILE
  }
}

/** Persist the profile; failures are swallowed (storage full/blocked). */
export function persistUserProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    /* storage full/blocked — profile still lives in the in-memory store */
  }
}
