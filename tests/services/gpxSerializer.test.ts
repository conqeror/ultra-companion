import { describe, expect, it } from "vitest";
import { serializeCollectionToGPX, serializeRouteToGPX } from "@/services/gpxSerializer";
import { toDisplayPOI } from "@/services/displayDistance";
import { buildStitchedCollection } from "@/tests/fixtures/collection";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import type { RouteWithPoints } from "@/types";

const points = [buildRoutePoint(0, 0), buildRoutePoint(1000, 1), buildRoutePoint(2000, 2)];

const route: RouteWithPoints = {
  id: "route-1",
  name: "A&B <Route>",
  fileName: "route.gpx",
  color: "#fff",
  isActive: false,
  isVisible: true,
  totalDistanceMeters: 2000,
  totalAscentMeters: 0,
  totalDescentMeters: 0,
  pointCount: points.length,
  createdAt: "2026-05-05T00:00:00.000Z",
  points,
};

describe("gpxSerializer", () => {
  it("serializes a route track and escapes route names", () => {
    const gpx = serializeRouteToGPX(route);

    expect(gpx).toContain("<name>A&amp;B &lt;Route&gt;</name>");
    expect(gpx).toContain('<trkpt lat="0" lon="0">');
    expect(gpx).toContain('<trkpt lat="0" lon="2">');
  });

  it("exports starred POIs as on-route waypoint cues", () => {
    const poi = toDisplayPOI(
      buildPoi("poi-1", "route-1", 1500, {
        name: "Cafe & Fuel",
        category: "coffee",
        latitude: 48.1,
        longitude: 17.2,
        distanceFromRouteMeters: 250,
        tags: { notes: "24h window" },
      }),
    );

    const gpx = serializeRouteToGPX(route, { poisAsWaypoints: [poi] });

    expect(gpx).toContain('<wpt lat="0" lon="1.5">');
    expect(gpx).toContain("<name>Cafe &amp; Fuel (250 m off route)</name>");
    expect(gpx).toContain("<sym>Cafe</sym>");
    expect(gpx).toContain("POI coordinates: 48.1, 17.2");
    expect(gpx).toContain("Notes: 24h window");
  });

  it("uses stitched display distances for collection waypoint cues", () => {
    const collection = buildStitchedCollection({ points });
    const poi = toDisplayPOI(buildPoi("poi-2", "route-2", 500), 1000);

    const gpx = serializeCollectionToGPX("Collection", collection, { poisAsWaypoints: [poi] });

    expect(gpx).toContain("<name>Collection</name>");
    expect(gpx).toContain('<wpt lat="0" lon="1.5">');
  });

  it("rejects empty route exports", () => {
    expect(() => serializeRouteToGPX({ ...route, points: [], pointCount: 0 })).toThrow(
      "Cannot serialize GPX for route with no points",
    );
  });
});
