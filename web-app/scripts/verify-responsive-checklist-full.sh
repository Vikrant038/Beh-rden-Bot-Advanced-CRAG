#!/usr/bin/env bash
# FULL audit of docs/responsive-ui-upgrade-checklist.md — every logged row
# verified against the actual source, no sampling. Also reports which of the
# 1..150 item numbers are NOT documented in the log.
# Usage: bash scripts/verify-responsive-checklist-full.sh  (from web-app/)
set -u

cd "$(dirname "$0")/.." || exit 1

pass=0
fail=0
missing=""

check() {
  local item="$1" token="$2" file="$3"
  if [ ! -f "$file" ]; then
    echo "FAIL  #${item} (FILE MISSING: $file)"
    fail=$((fail + 1)); missing="${missing} #${item}"
    return
  fi
  if grep -qF -- "$token" "$file" 2>/dev/null; then
    echo "PASS  #${item} ($token in ${file})"
    pass=$((pass + 1))
  else
    echo "FAIL  #${item} ($token NOT in ${file})"
    fail=$((fail + 1)); missing="${missing} #${item}"
  fi
}

# An item may need several tokens/files; verify all, count as one check.
check_all() {
  local item="$1"; shift
  local ok=1 detail=""
  for spec in "$@"; do
    local token="${spec%%::*}" file="${spec##*::}"
    if ! grep -qF -- "$token" "$file" 2>/dev/null; then
      ok=0; detail="${detail} [${token} NOT in ${file}]"
    fi
  done
  if [ "$ok" -eq 1 ]; then
    echo "PASS  #${item} (${#} specs)"
    pass=$((pass + 1))
  else
    echo "FAIL  #${item}${detail}"
    fail=$((fail + 1)); missing="${missing} #${item}"
  fi
}

echo "════════ Phase 1 — Safety nets (P0) ════════"
check 1  "overflow-x"                            src/app/globals.css
check 2  "min-width: 320px"                      src/app/globals.css
check 3  "-webkit-tap-highlight-color"           src/app/globals.css
check 4  "hover: none"                           src/app/globals.css
check 5  "font-size: 16px"                       src/app/globals.css
check 6  "themeColor"                            src/app/layout.tsx
check 7  "viewportFit"                           src/app/layout.tsx
check 35 "history.length"                        src/components/chat/chat-layout.tsx
check_all 36 "md:opacity-0::src/components/sidebar/conversation-item.tsx" "md:group-hover::src/components/sidebar/conversation-item.tsx"
check 37 "85vw"                                  src/components/chat/chat-layout.tsx
check 39 "overscroll-contain"                    src/components/chat/chat-layout.tsx
check 43 "drawer-in"                             src/app/globals.css
check 57 "safe-area-inset-bottom"                src/components/chat/chat-input.tsx
check_all 138 "min-h-11::src/components/sources/source-browser.tsx" "min-w-11::src/components/chat/message-bubble.tsx" "min-h-11::src/components/sidebar/conversation-item.tsx"
check 139 "touch-pan-y"                          src/app/globals.css

echo "════════ Phase 2a — Landing page (page.tsx) ════════"
check 13 "md:py-3"                               src/app/page.tsx
check 14 "scroll-mt-20"                          src/app/page.tsx
check 15 "min-[400px]:text-4xl"                  src/app/page.tsx
check 16 "aspect-[4/3]"                          src/app/page.tsx
check 17 "max-w-xs"                              src/app/page.tsx
check 18 "min-[360px]:grid-cols-2"               src/app/page.tsx
check 19 "tabular-nums"                          src/app/page.tsx
check 20 "gap-10"                                src/app/page.tsx
check 21 "order-last lg:order-first"             src/app/page.tsx
check 22 "sm:block"                              src/app/page.tsx
check_all 23 "p-4::src/app/page.tsx" "sm:p-5::src/app/page.tsx"
check_all 24 "sm:h-11::src/app/page.tsx" "sm:w-11::src/app/page.tsx"
check_all 25 "line-clamp-2::src/app/page.tsx" "sm:truncate::src/app/page.tsx"
check 26 "min-h-11"                              src/app/page.tsx
check_all 27 "py-3.5::src/app/page.tsx" "sm:py-4::src/app/page.tsx"
check 28 "px-5 py-10 sm:px-8 sm:py-14"           src/app/page.tsx
check 29 "gap-6"                                 src/app/page.tsx
check 30 "bottom-20"                             src/app/page.tsx
check 31 "usePathname"                           src/app/page.tsx
check_all 32 "pb-16::src/app/page.tsx" "sm:pb-24::src/app/page.tsx"
check 33 "opacity-40"                            src/app/page.tsx

echo "════════ Phase 2b — Chat components ════════"
check_all 46 "sm:py-14::src/components/chat/chat-empty-state.tsx" "sm:h-28::src/components/chat/chat-empty-state.tsx"
check 47 "min-h-11"                              src/components/chat/chat-interface.tsx
check 48 "bottom-36"                             src/components/chat/chat-interface.tsx
check 49 "break-words"                           src/components/chat/message-bubble.tsx
check 51 "min-w-11"                              src/components/chat/message-bubble.tsx
check 53 "h-10 w-10"                            src/components/chat/chat-input.tsx
check 54 "sm:flex-row"                           src/components/chat/chat-input.tsx
check 55 "min-[400px]"                           src/components/chat/chat-input.tsx
check 56 "overflow-x-auto"                       src/components/chat/chat-input.tsx
check 59 "min-h-11"                              src/components/chat/chat-interface.tsx
check 61 "overflow-x-auto"                       src/components/chat/pipeline-status.tsx

echo "════════ Phase 2c — Sources / History / Settings / Login ════════"
check_all 62 "text-xl::src/app/sources/page.tsx" "sm:text-2xl::src/app/sources/page.tsx"
check 63 "overflow-x-auto"                       src/components/sources/source-browser.tsx
check 64 "Back to documents"                     src/components/sources/source-browser.tsx
check 65 "min-w-11"                              src/components/sources/source-browser.tsx
check 68 "break-words"                           src/components/sources/source-browser.tsx
check 69 "sm:text-xl"                            src/components/history/history-list.tsx
check 70 "flex-1"                                src/components/history/history-list.tsx
check 71 "min-h-11"                              src/components/history/history-list.tsx
check 73 "h-11 w-11"                             src/components/history/history-list.tsx
check 75 "pb-2"                                  src/components/history/history-list.tsx
check 76 "p-4 sm:p-5"                            src/app/settings/page.tsx
check 77 "min-h-11"                              src/app/settings/page.tsx
check 78 "flex-wrap"                             src/app/settings/page.tsx
check 80 "scroll-mt-20"                          src/app/settings/page.tsx
check 81 "sm:p-8"                                src/app/login/login-content.tsx
check 82 "sm:px-6"                               src/app/login/login-content.tsx
check_all 83 "min-h-12::src/app/login/login-content.tsx" "min-h-12::src/components/auth/oauth-buttons.tsx" "active:scale::src/app/login/login-content.tsx"
check 85 "text-xs"                               src/app/login/login-content.tsx

echo "════════ Phase 2d — Admin ════════"
check 87 "min-h-11"                              src/app/admin/layout.tsx
check 88 "overflow-x-auto"                       src/app/admin/layout.tsx
check 89 "min-[380px]:grid-cols-2"               src/app/admin/dashboard/page.tsx
check 90 "flex-wrap"                             src/app/admin/dashboard/page.tsx
check 92 "fontSize: 10"                          src/components/admin/dashboard-charts.tsx
check 94 "90vw"                                  src/components/admin/dashboard-charts.tsx
check 97 "line-clamp-2"                          src/components/admin/recent-queries-table.tsx
check_all 98 "min-h-11::src/components/admin/top-questions.tsx" "line-clamp-2::src/components/admin/top-questions.tsx" "min-h-11::src/components/admin/failed-queries-card.tsx"
check 99 "min-h-12"                              src/app/admin/pipeline-tester/page.tsx
check 100 "overflow-x-auto"                      src/app/admin/pipeline-tester/page.tsx
check 101 "lg:ml-auto"                           src/app/admin/pipeline-tester/page.tsx
check_all 102 "aria-expanded::src/components/admin/pipeline/stage-node.tsx" "aria-controls::src/components/admin/pipeline/stage-node.tsx" "onClick::src/components/admin/pipeline/stage-node.tsx" "shrink-0::src/components/admin/pipeline/stage-node.tsx"
check 103 "sm:grid-cols-2"                       src/components/admin/pipeline/pipeline-visualizer.tsx
check 104 "min-w-0"                              src/components/admin/pipeline/react-step.tsx
check 106 "break-all"                            src/components/admin/pipeline/pipeline-visualizer.tsx
check 127 "min-h-12"                             src/components/admin/document-manager.tsx
check 128 "basis-56"                             src/components/admin/document-manager.tsx
check 130 "min-w-11"                             src/components/admin/document-manager.tsx

echo "════════ Phase 3 — Tablet tuning ════════"
check 134 "md:grid-cols-4"                       src/app/admin/dashboard/page.tsx
check 136 "md:grid-cols-["                         src/components/sources/source-browser.tsx

echo "════════ Phase 4 — Polish & a11y ════════"
check 109 "-webkit-overflow-scrolling"           src/app/globals.css
check 110 "max-width: 100%"                      src/app/globals.css
check 111 "0.75rem"                              src/app/globals.css
check 113 "1rem"                                 src/app/globals.css
check 114 "85dvh"                                src/components/ui/dialog.tsx
check 115 "80dvh"                                src/components/ui/changelog-modal.tsx
check 118 "truncate"                             src/components/ui/badge.tsx
check_all 119 "min-h-11::src/components/ui/input.tsx" "sm:text-sm::src/components/ui/input.tsx"
check 120 "min-h-10"                             src/components/ui/button.tsx
check 122 "sm:py-16"                             src/components/ui/empty-state.tsx
check 123 "min-h-11"                             src/components/ui/error-state.tsx
check 124 "min-h-11"                             src/components/ui/back-button.tsx
check 125 "min-w-0"                              src/components/ui/glass-card.tsx
check_all 126 "overflow-x-auto::src/components/ui/tabs.tsx" "whitespace-nowrap::src/components/ui/tabs.tsx"
check 141 "passive"                              src/app/page.tsx
check 143 "prefers-reduced-transparency"         src/app/globals.css
check 146 "aria-label"                           src/app/admin/pipeline-tester/page.tsx
check_all 148 "scroll-mt-20::src/app/page.tsx" "scroll-mt-safe::src/app/globals.css"

echo ""
echo "════════ UNLOGGED item numbers in 1..150 ════════"
logged=$(grep -oE '^\| *[0-9]+' docs/responsive-ui-upgrade-checklist.md | grep -oE '[0-9]+' | sort -n -u)
for n in $(seq 1 150); do
  if ! echo "$logged" | grep -qx "$n"; then
    printf "%s " "$n"
  fi
done
echo ""
echo ""
echo "════════ SUMMARY ════════"
echo "PASS: ${pass}   FAIL: ${fail}"
if [ -n "$missing" ]; then
  echo "Failed items:${missing}"
  exit 1
fi
echo "All logged checklist rows verified in source."
