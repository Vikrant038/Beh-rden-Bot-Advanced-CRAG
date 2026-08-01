import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - value.getTime()) / 1000);
  const intervals: Array<[number, string]> = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
  ];
  let unit = "s";
  let count = seconds;
  for (const [divisor, nextUnit] of intervals) {
    if (count < divisor) {
      unit = nextUnit;
      break;
    }
    count = Math.floor(count / divisor);
    unit = nextUnit;
  }
  return count === 0 ? "now" : `${count}${unit}`;
}

/**
 * Formats a `YYYY-MM-DD` string as a short day label for charts.
 * Shows the weekday when the date falls within the current week.
 */
export function formatRelativeDay(date: string): string {
  const target = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) {
    return date;
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return target.toLocaleDateString("en-US", { weekday: "short" });
  }
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
