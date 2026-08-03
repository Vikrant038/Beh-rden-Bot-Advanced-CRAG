import type { ConversationSummary } from "@/lib/chat/types";

export type TimeGroupKey = "today" | "yesterday" | "previous7" | "older";

export const TIME_GROUP_LABELS: Record<TimeGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  previous7: "Previous 7 days",
  older: "Older",
};

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Buckets conversations into Today / Yesterday / Previous 7 days / Older groups
 * based on their last-updated time. Pinned conversations (ids passed via
 * `pinnedIds`) are kept at the top of their group.
 */
export function groupConversationsByTime(
  conversations: ConversationSummary[],
  pinnedIds: Set<string> = new Set(),
): Array<{ key: TimeGroupKey; label: string; items: ConversationSummary[] }> {
  const now = new Date();
  const startOfToday = startOfDay(now);
  const startOfYesterday = startOfToday - DAY_MS;
  const startOfPrev7 = startOfToday - 7 * DAY_MS;

  const groups: Record<TimeGroupKey, ConversationSummary[]> = {
    today: [],
    yesterday: [],
    previous7: [],
    older: [],
  };

  for (const conversation of conversations) {
    const updated = startOfDay(new Date(conversation.updatedAt));
    const key: TimeGroupKey =
      updated >= startOfToday
        ? "today"
        : updated >= startOfYesterday
          ? "yesterday"
          : updated >= startOfPrev7
            ? "previous7"
            : "older";
    groups[key].push(conversation);
  }

  const order: TimeGroupKey[] = ["today", "yesterday", "previous7", "older"];

  return order
    .filter((key) => groups[key].length > 0)
    .map((key) => {
      const pinned = groups[key].filter((item) => pinnedIds.has(item.id));
      const rest = groups[key].filter((item) => !pinnedIds.has(item.id));
      return { key, label: TIME_GROUP_LABELS[key], items: [...pinned, ...rest] };
    });
}
