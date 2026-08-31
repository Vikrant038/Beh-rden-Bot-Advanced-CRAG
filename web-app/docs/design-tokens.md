# Behörden-Bot Design Tokens

This document serves as the reference for the design tokens used across the application to maintain a consistent visual rhythm and hierarchy.

## Colors
The application supports Light and Dark modes matching the diorama video aesthetic.

### Light Mode (Warm Diorama Porcelain & Clay)
- **Background:** `#fbf9f5` (warm, editorial porcelain)
- **Foreground:** `#1c1917` (deep charcoal ink)
- **Surface:** `#ffffff` (Hover: `#f5f0e8`)
- **Border:** `#e7e0d5`
- **Primary:** `#7c3aed` (Luminous Violet, Hover: `#6d28d9`, Foreground: `#ffffff`)
- **Accent:** `#0284c7` (Sky Blue)
- **Success:** `#15803d` (Emerald)
- **Warning:** `#b45309` (Amber)
- **Destructive:** `#b91c1c` (Crimson)
- **Muted:** `#57534e`
- **Glass:** `rgba(255, 255, 255, 0.72)` (Border: `rgba(28, 25, 23, 0.08)`)
- **Shadow Glass:** `0 8px 32px rgba(124, 58, 237, 0.08)`

### Dark Mode (Velvet Obsidian)
- **Background:** `#0f0d13` (velvet dark obsidian matching video backgrounds)
- **Foreground:** `#f8fafc` (crisp luminous text)
- **Surface:** `#181520` (Hover: `#221e2d`)
- **Border:** `#2a2538`
- **Primary:** `#a78bfa` (Luminous Violet, Hover: `#c4b5fd`, Foreground: `#0f0d13`)
- **Accent:** `#38bdf8`
- **Success:** `#4ade80`
- **Warning:** `#fbbf24`
- **Destructive:** `#f87171`
- **Muted:** `#94a3b8`
- **Glass:** `rgba(24, 21, 32, 0.75)` (Border: `rgba(255, 255, 255, 0.09)`)
- **Shadow Glass:** `0 8px 32px rgba(0, 0, 0, 0.45)`

### Hero & Stage Cinematic Accents
Harmonized across the scroll hero segments, badges, and status pills:
- **Start (Arrival & Overview):** `#7c3aed` (Royal Violet)
- **Documents (Paperwork & BAMF):** `#2563eb` (Cobalt Blue)
- **APS (Verification & Recognition):** `#059669` (Forest Emerald)
- **Campus (Enrollment & Graduation):** `#d97706` (Sunburst Amber)

## Typography Scale
*Configured in `globals.css` with professional variable fonts.*
- **Font Sans (UI & Body):** `"Source Sans 3 Variable", ui-sans-serif, system-ui, sans-serif`
- **Font Display (Headings):** `"Source Serif 4 Variable", ui-serif, Georgia, serif`
- **Font Mono (Code & Traces):** `"JetBrains Mono Variable", ui-monospace, monospace`
- **Text 2xs:** `0.6875rem` (11px)

## Radius Scale
*Used for border radiuses.*
- **xs:** `0.375rem` (6px)
- **sm:** `0.5rem` (8px)
- **md:** `0.75rem` (12px)
- **lg:** `1rem` (16px)
- **xl:** `1.5rem` (24px)

## Spacing
We utilize the default Tailwind CSS v4 spacing scale which is based on a `0.25rem` (4px) base rhythm. Ensure spacing utilities (e.g., `p-4`, `gap-2`, `m-6`) adhere to this system.
