import { describe, expect, it } from "vitest";
import { poiMapIconImageId } from "@/constants";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildPOIMapFeatureCollections } from "@/utils/poiMapFeatures";
import type { DisplayPOI } from "@/types";

function buildDisplayPoi(id: string, overrides: Parameters<typeof buildPoi>[3] = {}): DisplayPOI {
  return {
    ...buildPoi(id, "route-1", 100, overrides),
    effectiveDistanceMeters: 100,
  } as DisplayPOI;
}

describe("buildPOIMapFeatureCollections", () => {
  it("splits non-starred and starred POIs into separate feature collections", () => {
    const regular = buildDisplayPoi("regular", {
      category: "water",
      name: null,
      latitude: 48.1,
      longitude: 17.1,
    });
    const starred = buildDisplayPoi("starred", {
      category: "gas_station",
      name: "Fuel Stop",
      latitude: 48.2,
      longitude: 17.2,
    });

    const result = buildPOIMapFeatureCollections([regular, starred], new Set(["starred"]));

    expect(result.clustered.features).toHaveLength(1);
    expect(result.starred.features).toHaveLength(1);
    expect(result.clustered.features[0]).toMatchObject({
      properties: {
        poiId: "regular",
        category: "water",
        color: "#3B82F6",
        iconImage: poiMapIconImageId("Droplets"),
        name: "",
        starred: 0,
      },
      geometry: {
        type: "Point",
        coordinates: [17.1, 48.1],
      },
    });
    expect(result.starred.features[0]).toMatchObject({
      properties: {
        poiId: "starred",
        category: "gas_station",
        color: "#F97316",
        iconImage: poiMapIconImageId("Fuel"),
        name: "Fuel Stop",
        starred: 1,
      },
      geometry: {
        type: "Point",
        coordinates: [17.2, 48.2],
      },
    });
  });
});
