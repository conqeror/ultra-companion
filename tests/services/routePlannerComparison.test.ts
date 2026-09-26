import { describe, expect, it } from "vitest";
import { parseBRouterRoute } from "@/services/brouterClient";
import {
  arePlannerRoutesEffectivelySame,
  routePlannerCandidateColor,
  routePlannerCandidateId,
  sortPlannerCandidates,
} from "@/services/routePlannerComparison";
import type { RoutePlannerCandidate } from "@/types";

function route(midpointLatitude: number) {
  return parseBRouterRoute({
    type: "FeatureCollection",
    features: [
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [17.1, 48.1, 100],
            [17.15, midpointLatitude, 200],
            [17.2, 48.2, 120],
          ],
        },
      },
    ],
  });
}

describe("route planner comparison helpers", () => {
  it("treats tiny geometry variation as duplicate but preserves a real detour", () => {
    const original = route(48.15);
    expect(arePlannerRoutesEffectivelySame(original, route(48.15005))).toBe(true);
    expect(arePlannerRoutesEffectivelySame(original, route(48.25))).toBe(false);
  });

  it("sorts by selected profile order and then BRouter alternative index", () => {
    const parsed = route(48.15);
    const candidates: RoutePlannerCandidate[] = [
      {
        id: routePlannerCandidateId("quiet", 2),
        profileId: "quiet",
        profileName: "Quiet",
        alternativeIndex: 2,
        route: parsed,
      },
      {
        id: routePlannerCandidateId(null, 0),
        profileId: null,
        profileName: "Road cycling",
        alternativeIndex: 0,
        route: parsed,
      },
      {
        id: routePlannerCandidateId("quiet", 0),
        profileId: "quiet",
        profileName: "Quiet",
        alternativeIndex: 0,
        route: parsed,
      },
    ];
    expect(
      sortPlannerCandidates(candidates, ["quiet", null]).map((candidate) => candidate.id),
    ).toEqual(["quiet:0", "quiet:2", "builtin:0"]);
  });

  it("keeps candidate colors stable when other candidates are inserted", () => {
    expect(routePlannerCandidateColor("quiet:2")).toBe(routePlannerCandidateColor("quiet:2"));
  });
});
