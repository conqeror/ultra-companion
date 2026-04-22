import type { POICategoryMeta } from "@/types";
import type { OpeningHoursStatus } from "@/types";
import { POI_CATEGORIES } from "./index";

const categoryMap = new Map<string, POICategoryMeta>(POI_CATEGORIES.map((c) => [c.key, c]));

export function getCategoryMeta(key: string): POICategoryMeta | undefined {
  return categoryMap.get(key);
}

export function categoryColor(key: string): string {
  return categoryMap.get(key)?.color ?? "#888";
}

export function categoryLetter(key: string): string {
  return categoryMap.get(key)?.label?.charAt(0) ?? "?";
}

/**
 * Derive a theme color for an opening hours status.
 * Returns the color key name so callers can look it up from their theme colors.
 */
export function ohStatusColorKey(
  status: OpeningHoursStatus | null,
): "positive" | "warning" | "destructive" | null {
  if (!status) return null;
  if (!status.isOpen) return "destructive";
  if (status.closingSoon) return "warning";
  return "positive";
}
