#!/usr/bin/env bash
# Audit script for docs/responsive-ui-upgrade-checklist.md — greps the actual
# source for each claim's distinctive token and reports PASS/FAIL per item.
# Usage: bash scripts/verify-responsive-checklist.sh  (from web-app/)
set -u

cd "$(dirname "$0")/.." || exit 1
ROOT="src"

pass=0
fail=0
missing_items=""

check() {
  local item="$1" token="$2" file="$3"
  if grep -qF -- "$token" "$file" 2>/dev/null; then
    echo "PASS  #${item} (${token} in ${file})"
    pass=$((pass + 1))
  else
    echo "FAIL  #${item} (${token} NOT in ${file})"
    fail=$((fail + 1))
    missing_items="${missing_items} #${item}"
  fi
}

echo "── Phase 1: Safety nets (globals.css / layout.tsx) ──"
check 1  "overflow-x"                                   src/app/globals.css
check 2  "min-width: 320px"                             src/app/globals.css
check 3  "-webkit-tap-highlight-color"                  src/app/globals.css
check 4  "hover: none"                                  src/app/globals.css
check 5  "font-size: 16px"                              src/app/globals.css
check 6  "themeColor"                                   src/app/layout.tsx
check 7  "viewportFit"                                  src/app/layout.tsx
check 43 "drawer-in"                                    src/app/globals.css
check 139 "touch-pan-y"                                 src/app/globals.css
check 148 "scroll-mt-safe"                              src/app/globals.css

echo "── Landing page (page.tsx) ──"
check 13 "py-2 sm:px-6 md:py-3"                         src/app/page.tsx
check 15 "min-[400px]:text-4xl"                        src/app/page.tsx
check 16 "aspect-[4/3]"                                 src/app/page.tsx
check 17 "max-w-xs"                                     src/app/page.tsx
check 18 "min-[360px]:grid-cols-2"                      src/app/page.tsx
check 19 "tabular-nums"                                 src/app/page.tsx
check 21 "order-last lg:order-first"                    src/app/page.tsx
check 25 "line-clamp-2"                                 src/app/page.tsx
check 26 "min-h-11"                                     src/app/page.tsx
check 30 "bottom-20"                                    src/app/page.tsx
check 31 "usePathname"                                  src/app/page.tsx
check 33 "opacity-40"                                   src/app/page.tsx

echo "── Admin layout / dashboard ──"
check 87 "min-h-11"                                     src/app/admin/layout.tsx
check 88 "overflow-x-auto"                              src/app/admin/layout.tsx
check 89 "min-[380px]:grid-cols-2"                      src/app/admin/dashboard/page.tsx
check 99 "min-h-12"                                     src/app/admin/pipeline-tester/page.tsx
check 100 "overflow-x-auto"                             src/app/admin/pipeline-tester/page.tsx

echo "── Pipeline components (stage-node, react-step, visualizer) ──"
check 102 "aria-controls"                               src/components/admin/pipeline/stage-node.tsx
check 102 "aria-expanded"                               src/components/admin/pipeline/stage-node.tsx
check 104 "min-w-0"                                     src/components/admin/pipeline/react-step.tsx
check 106 "break-all"                                   src/components/admin/pipeline/pipeline-visualizer.tsx

echo "── Chat components ──"
check 46 "sm:py-14"                                    src/components/chat/chat-empty-state.tsx
check 47 "min-h-11"                                    src/components/chat/chat-interface.tsx
check 48 "bottom-36"                                   src/components/chat/chat-interface.tsx
check 51 "min-w-11"                                    src/components/chat/message-bubble.tsx
check 53 "sm:h-10"                                     src/components/chat/chat-input.tsx
check 56 "overflow-x-auto"                             src/components/chat/chat-input.tsx
check 57 "safe-area-inset-bottom"                      src/components/chat/chat-input.tsx
check 61 "overflow-x-auto"                             src/components/chat/pipeline-status.tsx

check 37 "85vw"                                       src/components/chat/chat-layout.tsx
check 39 "overscroll-contain"                          src/components/chat/chat-layout.tsx
check 35 "history.length"                              src/components/chat/chat-layout.tsx
check 36 "touch"                                      src/components/sidebar/conversation-item.tsx

check 46 "sm:h-28"                                    src/components/chat/chat-empty-state.tsx

echo "── Sources / History / Settings ──"
check 63 "overflow-x-auto"                             src/components/sources/source-browser.tsx
check 65 "min-w-11"                                   src/components/sources/source-browser.tsx
check 68 "break-words"                                src/components/sources/source-browser.tsx
check 70 "flex-1"                                     src/components/history/history-list.tsx
check 71 "min-h-11"                                   src/components/history/history-list.tsx
check 76 "sm:p-5"                                     src/app/settings/page.tsx
check 80 "scroll-mt-20"                              src/app/settings/page.tsx
check 81 "sm:p-8"                                     src/app/login/login-content.tsx
check 82 "sm:px-6"                                    src/app/login/login-content.tsx
check 83 "min-h-12"                                   src/app/login/login-content.tsx
check 83 "min-h-12"                                   src/components/auth/oauth-buttons.tsx

check 128 "line-clamp-2"                              src/components/admin/document-manager.tsx
check 127 "min-h-12"                                  src/components/admin/document-manager.tsx
check 130 "min-w-11"                                  src/components/admin/document-manager.tsx

echo "── Shared UI kit ──"
check 114 "max-h-[85dvh]"                               src/components/ui/dialog.tsx
check 118 "truncate"                                    src/components/ui/badge.tsx
check 119 "min-h-11"                                    src/components/ui/input.tsx
check 120 "min-h-10"                                    src/components/ui/button.tsx
check 122 "sm:py-16"                                    src/components/ui/empty-state.tsx
check 123 "min-h-11"                                    src/components/ui/error-state.tsx
check 124 "min-h-11"                                    src/components/ui/back-button.tsx
check 125 "min-w-0"                                     src/components/ui/glass-card.tsx
check 126 "overflow-x-auto"                             src/components/ui/tabs.tsx

echo ""
echo "── SUMMARY ──"
echo "PASS: ${pass}   FAIL: ${fail}"
if [ -n "$missing_items" ]; then
  echo "Missing items:${missing_items}"
  exit 1
fi
echo "All sampled checklist claims verified in source."
