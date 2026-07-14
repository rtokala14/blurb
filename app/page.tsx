import { redirect } from "next/navigation"

/**
 * The workspace lands on Chat by default. The former dashboard route now
 * redirects here so any existing bookmarks or logo links to "/" still resolve.
 */
export default function RootPage() {
  redirect("/chat")
}
