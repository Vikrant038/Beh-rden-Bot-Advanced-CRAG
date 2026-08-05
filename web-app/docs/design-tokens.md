# Behörden-Bot Design Tokens

This document serves as the reference for the design tokens used across the application to maintain a consistent visual rhythm and hierarchy.

## Colors
The application supports Light and Dark modes.

### Light Mode (Paper & Ink)
- **Background:** `#faf7f2`
- **Foreground:** `#1f2430`
- **Surface:** `#ffffff` (Hover: `#f3efe7`)
- **Border:** `#e5ded2`
- **Primary:** `#3f5bd6` (Hover: `#3249b8`, Foreground: `#ffffff`)
- **Accent:** `#0e7490`
- **Success:** `#15803d`
- **Warning:** `#b45309`
- **Destructive:** `#b91c1c`
- **Muted:** `#525866`
- **Glass:** `rgba(255, 255, 255, 0.62)` (Border: `rgba(31, 36, 48, 0.1)`)
- **Shadow Glass:** `0 8px 32px rgba(90, 90, 140, 0.16)`

### Dark Mode (Midnight)
- **Background:** `#0b1020`
- **Foreground:** `#e8ecf8`
- **Surface:** `#111832` (Hover: `#1a2340`)
- **Border:** `#232e4f`
- **Primary:** `#7c9cff` (Hover: `#93aeff`, Foreground: `#0b1020`)

## Typography Scale
*Configured in `globals.css` and applied via Tailwind CSS default classes.*
- **Font Sans:** `"Source Sans 3 Variable", ui-sans-serif, system-ui, sans-serif`
- **Font Mono:** `"JetBrains Mono Variable", ui-monospace, monospace`
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
