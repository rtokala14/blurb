import localFont from "next/font/local"

/**
 * Jacobs Chronos — the corporate brand typeface. woff2 (with woff fallback)
 * from the official web kit. Weight map: Light 300, Regular 400, Bold 700,
 * Heavy 800, each with a matching italic. The Display cut is a separate
 * family reserved for large wordmark/hero type.
 */
export const chronos = localFont({
  variable: "--font-chronos",
  display: "swap",
  preload: true,
  src: [
    { path: "./fonts/JacobsChronos_W_Lt.woff2", weight: "300", style: "normal" },
    { path: "./fonts/JacobsChronos_W_LtIt.woff2", weight: "300", style: "italic" },
    { path: "./fonts/JacobsChronos_W_Rg.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JacobsChronos_W_It.woff2", weight: "400", style: "italic" },
    { path: "./fonts/JacobsChronos_W_Bd.woff2", weight: "700", style: "normal" },
    { path: "./fonts/JacobsChronos_W_BdIt.woff2", weight: "700", style: "italic" },
    { path: "./fonts/JacobsChronos_W_He.woff2", weight: "800", style: "normal" },
    { path: "./fonts/JacobsChronos_W_HeIt.woff2", weight: "800", style: "italic" },
  ],
})

export const chronosDisplay = localFont({
  variable: "--font-chronos-display",
  display: "swap",
  src: [
    { path: "./fonts/JacobsChronos_W_Display.woff2", weight: "400 800", style: "normal" },
  ],
})
