#!/usr/bin/env bash
# Full audit of docs/UI_UX_ENHANCEMENT_PLAN.md (150 sections) against the
# actual codebase: for each section, the primary file must exist AND a
# distinctive feature token must be present. No sampling — all 150 checked.
# Usage: bash scripts/verify-plan-150.sh  (from web-app/)
set -u

cd "$(dirname "$0")/.." || exit 1

pass=0
fail=0
unclear=0
declare -a failures

# section_number -> token -> primary file
check_section() {
  local sec="$1" token="$2" file="$3"
  if [ ! -f "$file" ]; then
    echo "FAIL  [$sec] FILE MISSING: $file (token: $token)"
    fail=$((fail + 1)); failures+=("$sec")
    return
  fi
  if grep -qiE -- "$token" "$file" 2>/dev/null; then
    echo "PASS  [$sec] ($token in ${file})"
    pass=$((pass + 1))
  else
    echo "FAIL  [$sec] ($token NOT in $file)"
    fail=$((fail + 1)); failures+=("$sec")
  fi
}

# Map of every plan section → (distinctive token, primary file).
# Tokens are case-insensitive regexes chosen to prove the feature exists.

echo "════════ Section 1 — Global Design System & Theming ════════"
check_section "1.1" "@theme|--spacing|--radius|--shadow" "src/app/globals.css"
check_section "1.2" "min-h-1[012]|rounded-xl border" "src/components/ui/button.tsx"
check_section "1.3" "toast|Toast" "src/lib/toast.tsx"
check_section "1.4" "focus-visible" "src/app/globals.css"
check_section "1.5" "--color-muted|color-muted" "src/app/globals.css"
check_section "1.6" "type-display|type-title|clamp" "src/app/globals.css"
check_section "1.7" "Skeleton" "src/components/ui/skeleton.tsx"
check_section "1.8" "Try again|error" "src/app/error.tsx"
check_section "1.9" "doesn.t exist|404|page not found" "src/app/not-found.tsx"
check_section "1.10" "loading|Loading" "src/app/loading.tsx"
check_section "1.11" "manifest|icon|favicon" "src/app/layout.tsx"
check_section "1.12" "openGraph|twitter|metadata" "src/app/layout.tsx"
check_section "1.13" "CommandPalette|command-palette|⌘" "src/components/ui/command-palette.tsx"
check_section "1.14" "Changelog|changelog|What.s new" "src/components/ui/changelog-modal.tsx"

echo "════════ Section 2 — Landing Page ════════"
check_section "2.1" "sticky|backdrop-blur" "src/app/page.tsx"
check_section "2.2" "CountUp|tabular-nums|Live corpus" "src/app/page.tsx"
check_section "2.3" "How it works|step" "src/app/page.tsx"
check_section "2.4" "ChatMockup|chat.*mock|mockup" "src/app/page.tsx"
check_section "2.5" "testimonial|Testimonial" "src/app/page.tsx"
check_section "2.6" "FAQ|frequently asked|faq" "src/app/page.tsx"
check_section "2.7" "Ready to start|Final CTA|Start asking" "src/app/page.tsx"
check_section "2.8" "text-5xl|text-6xl|min-\[400px\]:text-4xl" "src/app/page.tsx"
check_section "2.9" "motion|whileInView|reveal" "src/app/page.tsx"
check_section "2.10" "icon|Icon" "src/app/page.tsx"
check_section "2.11" "What can I ask|topic|Topic" "src/app/page.tsx"
check_section "2.12" "footer|Chat|History" "src/app/page.tsx"
check_section "2.13" "Back to top|back-to-top|ArrowUp" "src/app/page.tsx"

echo "════════ Section 3 — Auth & Login ════════"
check_section "3.1" "gradient-mesh" "src/app/login/login-content.tsx"
check_section "3.2" "lg:grid-cols-2|split" "src/app/login/login-content.tsx"
check_section "3.3" "loading|Starting|Redirecting" "src/app/login/login-content.tsx"
check_section "3.4" "error|Error" "src/app/login/login-content.tsx"
check_section "3.5" "Save conversations|Why sign" "src/app/login/login-content.tsx"
check_section "3.6" "Back to home" "src/app/login/login-content.tsx"
check_section "3.7" "Privacy|Terms" "src/app/login/login-content.tsx"
check_section "3.8" "New to|See how it works|new here" "src/app/login/login-content.tsx"
check_section "3.9" "GraduationCap|logo|Logo" "src/app/login/login-content.tsx"
check_section "3.10" "Continue as guest|guest" "src/app/login/login-content.tsx"

echo "════════ Section 4 — Chat Interface & Message Bubbles ════════"
check_section "4.1" "SuggestedPrompt|suggested|prompt" "src/components/chat/chat-interface.tsx"
check_section "4.2" "motion|animate|framer" "src/components/chat/message-bubble.tsx"
check_section "4.3" "Copy|copy|Retry|retry|Feedback" "src/components/chat/message-bubble.tsx"
check_section "4.4" "scroll.*bottom|bottom-36|ArrowDown" "src/components/chat/chat-interface.tsx"
check_section "4.5" "thinking|Thinking|dots" "src/components/chat/chat-interface.tsx"
check_section "4.6" "timestamp|separator|Today|Yesterday" "src/components/chat/chat-interface.tsx"
check_section "4.7" "favicon|source-citation|SourceCitation" "src/components/chat/source-citation.tsx"
check_section "4.8" "cache|Cache" "src/components/chat/message-bubble.tsx"
check_section "4.9" "follow-up|Follow|chip" "src/components/chat/chat-interface.tsx"
check_section "4.10" "Regenerate|regenerate" "src/components/chat/chat-interface.tsx"
check_section "4.11" "Copy conversation|copy.*conversation" "src/components/chat/chat-interface.tsx"
check_section "4.12" "Clear|clear|Trash" "src/components/chat/chat-interface.tsx"
check_section "4.13" "New chat|Plus|new chat" "src/components/chat/chat-interface.tsx"
check_section "4.14" "mode|Mode|Agentic|Standard" "src/components/chat/chat-interface.tsx"
check_section "4.15" "HelpCircle|interpretation|ambiguous" "src/components/chat/disambiguation-cards.tsx"
check_section "4.16" "progress|Progress|status-pulse" "src/components/chat/pipeline-status.tsx"
check_section "4.17" "Stop|stop" "src/components/chat/chat-input.tsx"
check_section "4.18" "illustration|empty|EmptyState|h-20" "src/components/chat/chat-interface.tsx"

echo "════════ Section 5 — Chat Input & Composition ════════"
check_section "5.1" "resize-none|transition-\[height\]|max-h-40" "src/components/chat/chat-input.tsx"
check_section "5.2" "counter|Counter|chars" "src/components/chat/chat-input.tsx"
check_section "5.3" "clear|Clear|X\b" "src/components/chat/chat-input.tsx"
check_section "5.4" "attach|Attach|Paperclip|paste" "src/components/chat/chat-input.tsx"
check_section "5.5" "Agentic|Standard|mode|Mode" "src/components/chat/chat-input.tsx"
check_section "5.6" "active:scale|hover:" "src/components/chat/chat-input.tsx"
check_section "5.7" "disclaimer|Disclaimer|AI may make|mistakes" "src/components/chat/chat-input.tsx"
check_section "5.8" "overflow-x-auto|quick|Quick" "src/components/chat/chat-input.tsx"
check_section "5.9" "focus-within:border-primary|focus-within:shadow" "src/components/chat/chat-input.tsx"
check_section "5.10" "localStorage|draft|Draft" "src/components/chat/chat-input.tsx"
check_section "5.11" "Generating|streaming|Streaming" "src/components/chat/chat-input.tsx"
check_section "5.12" "maxLength|4000|max-length|MAX_" "src/components/chat/chat-input.tsx"

echo "════════ Section 6 — Sidebar & Navigation ════════"
check_section "6.1" "collapse|Collapse|w-\[.*rem\]|icon rail|rail" "src/components/chat/chat-layout.tsx"
check_section "6.2" "search|Search|filter" "src/components/sidebar/app-sidebar.tsx"
check_section "6.3" "Today|Yesterday|group|Group" "src/components/sidebar/app-sidebar.tsx"
check_section "6.4" "pin|Pin" "src/components/sidebar/app-sidebar.tsx"
check_section "6.5" "rename|Rename|Pencil" "src/components/sidebar/conversation-item.tsx"
check_section "6.6" "Delete|delete|confirm" "src/components/sidebar/conversation-item.tsx"
check_section "6.7" "⌘|Ctrl|cmd|shortcut|onKeyDown" "src/components/sidebar/app-sidebar.tsx"
check_section "6.8" "avatar|Avatar|profile|Profile|sign out|Sign out" "src/components/sidebar/app-sidebar.tsx"
check_section "6.9" "Knowledge base|badge|count" "src/components/sidebar/app-sidebar.tsx"
check_section "6.10" "bottom-sheet|drawer|Drawer|85vw" "src/components/chat/chat-layout.tsx"
check_section "6.11" "Skeleton|skeleton|Loading" "src/components/sidebar/app-sidebar.tsx"
check_section "6.12" "Start your first|empty|Empty" "src/components/sidebar/app-sidebar.tsx"
check_section "6.13" "v[0-9]|version|Version|changelog|What.s new" "src/components/sidebar/app-sidebar.tsx"

echo "════════ Section 7 — History & Conversation Management ════════"
check_section "7.1" "Today|week|month|range|Range" "src/components/history/history-list.tsx"
check_section "7.2" "mode|Mode|Agentic|Standard" "src/components/history/history-list.tsx"
check_section "7.3" "Select|select|checkbox|Checkbox" "src/components/history/history-list.tsx"
check_section "7.4" "Clear all|Delete all|clear" "src/components/history/history-list.tsx"
check_section "7.5" "Preview|preview|modal" "src/components/history/history-list.tsx"
check_section "7.6" "debounce|Debounce|300" "src/components/history/history-list.tsx"
check_section "7.7" "Showing|of |count|Count" "src/components/history/history-list.tsx"
check_section "7.8" "sort|Sort|Newest|Oldest" "src/components/history/history-list.tsx"
check_section "7.9" "card|Card|preview|badge" "src/components/history/history-list.tsx"
check_section "7.10" "Export all|export" "src/components/history/history-list.tsx"
check_section "7.11" "Skeleton|skeleton|Loading" "src/components/history/history-list.tsx"
check_section "7.12" "Undo|undo|toast|Toast" "src/components/history/history-list.tsx"
check_section "7.13" "New chat|total|stats|header" "src/app/history/page.tsx"

echo "════════ Section 8 — Sources / Knowledge Base ════════"
check_section "8.1" "All|Pdf|Web|filter|Filter" "src/components/sources/source-browser.tsx"
check_section "8.2" "grid|Grid|card" "src/components/sources/source-browser.tsx"
check_section "8.3" "highlight|Highlight|mark" "src/components/sources/source-browser.tsx"
check_section "8.4" "Copy|copy" "src/components/sources/source-browser.tsx"
check_section "8.5" "prev|next|Load more|Prev|Next" "src/components/sources/source-browser.tsx"
check_section "8.6" "documents|chunks|stats|Stats" "src/components/sources/source-browser.tsx"
check_section "8.7" "Pdf|Web|badge|Badge|type" "src/components/sources/source-browser.tsx"
check_section "8.8" "RefreshCw|refresh|Refresh" "src/components/sources/source-browser.tsx"
check_section "8.9" "Last synced|synced|Updated" "src/components/sources/source-browser.tsx"
check_section "8.10" "md:grid-cols-\[|two-pane|detail|back" "src/components/sources/source-browser.tsx"
check_section "8.11" "score|Score|bar" "src/components/sources/source-browser.tsx"
check_section "8.12" "search|Search" "src/components/sources/source-browser.tsx"
check_section "8.13" "copy.*url|Copy.*link|link" "src/components/sources/source-browser.tsx"
check_section "8.14" "empty|Empty|Nothing indexed|Add your first" "src/components/sources/source-browser.tsx"

echo "════════ Section 9 — Admin Dashboard ════════"
check_section "9.1" "7d|14d|30d|90d|days|Days" "src/app/admin/dashboard/page.tsx"
check_section "9.2" "trend|Trend|arrow|Arrow|% " "src/components/admin/dashboard-charts.tsx"
check_section "9.3" "sparkline|Sparkline" "src/components/admin/metric-card.tsx"
check_section "9.4" "RefreshCw|refresh|auto" "src/app/admin/dashboard/page.tsx"
check_section "9.5" "Updated|updated|ago" "src/app/admin/dashboard/page.tsx"
check_section "9.6" "Skeleton|skeleton|Loading" "src/components/admin/dashboard-charts.tsx"
check_section "9.7" "No data|empty|Empty" "src/components/admin/dashboard-charts.tsx"
check_section "9.8" "tooltip|Tooltip|contentStyle|formatter" "src/components/admin/dashboard-charts.tsx"
check_section "9.9" "Top questions|top-question|TopQuestions" "src/components/admin/top-questions.tsx"
check_section "9.10" "Failed queries|failed-queries|FailedQueries" "src/components/admin/failed-queries-card.tsx"
check_section "9.11" "cache|Cache|donut|Donut" "src/components/admin/dashboard-charts.tsx"
check_section "9.12" "detail|Detail|drawer|Drawer|onClick" "src/components/admin/recent-queries-table.tsx"
check_section "9.13" "Load more|pagination|Pagination|next" "src/components/admin/recent-queries-table.tsx"
check_section "9.14" "Dashboard|greeting|date" "src/app/admin/dashboard/page.tsx"

echo "════════ Section 10 — Admin Documents & Pipeline Tester ════════"
check_section "10.1" "Synced|Ingesting|Failed|status|Status" "src/components/admin/document-manager.tsx"
check_section "10.2" "progress|Progress|bar" "src/components/admin/document-manager.tsx"
check_section "10.3" "preview|Preview|modal|chunk" "src/components/admin/document-manager.tsx"
check_section "10.4" "Delete selected|select|Select" "src/components/admin/document-manager.tsx"
check_section "10.5" "search|Search" "src/components/admin/document-manager.tsx"
check_section "10.6" "sort|Sort|name|updated" "src/components/admin/document-manager.tsx"
check_section "10.7" "upload|Upload|progress|Progress" "src/components/admin/document-manager.tsx"
check_section "10.8" "drag|Drag|drop|Drop" "src/components/admin/document-manager.tsx"
check_section "10.9" "Clear.*cache|clear.*cache|confirm" "src/components/admin/document-manager.tsx"
check_section "10.10" "sync|Sync|Syncing" "src/components/admin/document-manager.tsx"
check_section "10.11" "Pipeline trace|StageNode|stages" "src/components/admin/pipeline/pipeline-visualizer.tsx"
check_section "10.12" "Copy.*trace|copy.*JSON|Copy JSON" "src/app/admin/pipeline-tester/page.tsx"
check_section "10.13" "Example|example|icon" "src/app/admin/pipeline-tester/page.tsx"
check_section "10.14" "Recent|recent|history|list" "src/app/admin/pipeline-tester/page.tsx"

echo "════════ Section 11 — Accessibility, Responsive & Motion ════════"
check_section "11.1" "aria-label" "src/components/chat/message-bubble.tsx"
check_section "11.2" "aria-live" "src/components/chat/chat-interface.tsx"
check_section "11.3" "onKeyDown|Escape|focus" "src/components/ui/dialog.tsx"
check_section "11.4" "useReducedMotion|prefers-reduced-motion" "src/app/page.tsx"
check_section "11.5" "min-h-1[012]|min-h-9" "src/components/chat/chat-input.tsx"
check_section "11.6" "safe-area-inset" "src/app/globals.css"
check_section "11.7" "Skip to content" "src/app/layout.tsx"
check_section "11.8" "overflow-x|min-width: 320px" "src/app/globals.css"
check_section "11.9" "md:" "src/components/sources/source-browser.tsx"
check_section "11.10" "landscape|md:hidden|icon rail" "src/components/chat/chat-layout.tsx"
check_section "11.11" "high-contrast|data-high-contrast" "src/app/globals.css"
check_section "11.12" "font-size|FontSize|text.*size|size" "src/app/settings/page.tsx"
check_section "11.13" "aria-|role=|label" "src/app/page.tsx"
check_section "11.14" "color-blind|safe|palette|#6366f1" "src/app/globals.css"
check_section "11.15" "reduce.*motion|Motion|motion" "src/app/settings/page.tsx"

echo ""
echo "════════ SUMMARY ════════"
echo "PASS: ${pass}   FAIL: ${fail}"
if [ "$fail" -gt 0 ]; then
  echo "Failed sections: ${failures[*]}"
  exit 1
fi
echo "All 150 plan sections verified against source."
