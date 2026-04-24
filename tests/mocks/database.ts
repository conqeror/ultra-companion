import { vi } from "vitest";
import type { getClimbsForRoute, updateClimbName } from "@/db/database";

export const databaseMocks = {
  getClimbsForRoute: vi.fn<typeof getClimbsForRoute>(),
  updateClimbName: vi.fn<typeof updateClimbName>(),
};
