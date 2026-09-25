import { setPlannedStopDurationTag } from "@/services/plannedStops";
import type { POIRiderFieldsPatch } from "@/types";

export function applyPOIRiderFields(
  currentTags: Record<string, string>,
  patch: POIRiderFieldsPatch,
): Record<string, string> {
  const tags = { ...currentTags };
  if (patch.notes !== undefined) {
    const notes = patch.notes.trim();
    if (notes) tags.notes = notes;
    else delete tags.notes;
  }
  return patch.plannedStopDurationMinutes === undefined
    ? tags
    : setPlannedStopDurationTag(tags, patch.plannedStopDurationMinutes);
}
