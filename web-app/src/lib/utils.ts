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
