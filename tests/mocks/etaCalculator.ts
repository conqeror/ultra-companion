import { vi } from "vitest";
import type { computeRouteETA } from "@/services/etaCalculator";

export const etaCalculatorMocks = {
  computeRouteETA: vi.fn<typeof computeRouteETA>(),
};
