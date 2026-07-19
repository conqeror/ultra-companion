import { describe, expect, it } from "vitest";
import {
  buildElevationProfileFerryMarkers,
  projectFerrySpansForRidingProfile,
  type ElevationProfileFerrySpan,
} from "@/utils/elevationProfileFerries";

const ferry = (
  startDistanceMeters: number,
  endDistanceMeters: number,
  id = "ferry-1",
): ElevationProfileFerrySpan => ({
  id,
  name: id,
  startDistanceMeters,
  endDistanceMeters,
});

describe("elevation profile ferry spans", () => {
  it("projects both ferry endpoints into riding distance while retaining ferry length", () => {
    expect(
      projectFerrySpansForRidingProfile(
        [ferry(2_000, 5_000)],
        [{ startDistanceMeters: 2_000, endDistanceMeters: 5_000 }],
      ),
    ).toEqual([
      {
        id: "ferry-1",
        name: "ferry-1",
        startDistanceMeters: 2_000,
        endDistanceMeters: 2_000,
        routeLengthMeters: 3_000,
      },
    ]);
  });

  it("lays out real intervals from their start and end route distances", () => {
    expect(
      buildElevationProfileFerryMarkers([ferry(2_000, 4_000)], {
        totalDistanceMeters: 5_000,
        contentWidthPixels: 500,
        distanceOffsetMeters: 1_000,
      }),
    ).toEqual([
      {
        id: "ferry-1",
        name: "ferry-1",
        leftPixels: 100,
        widthPixels: 200,
        centerXPixels: 200,
        isCollapsed: false,
      },
    ]);
  });

  it("scales an excluded crossing marker using its retained ferry length", () => {
    expect(
      buildElevationProfileFerryMarkers([{ ...ferry(1_000, 1_000), routeLengthMeters: 600 }], {
        totalDistanceMeters: 5_000,
        contentWidthPixels: 500,
        distanceOffsetMeters: 1_000,
      }),
    ).toEqual([
      {
        id: "ferry-1",
        name: "ferry-1",
        leftPixels: 0,
        widthPixels: 60,
        centerXPixels: 0,
        isCollapsed: true,
      },
    ]);
  });

  it("keeps projected ferry widths proportional to crossing length", () => {
    const markers = buildElevationProfileFerryMarkers(
      [
        { ...ferry(2_000, 2_000, "short"), routeLengthMeters: 500 },
        { ...ferry(4_000, 4_000, "long"), routeLengthMeters: 2_000 },
      ],
      {
        totalDistanceMeters: 10_000,
        contentWidthPixels: 1_000,
      },
    );

    expect(markers.map(({ id, widthPixels }) => ({ id, widthPixels }))).toEqual([
      { id: "short", widthPixels: 50 },
      { id: "long", widthPixels: 200 },
    ]);
  });

  it("filters spans outside a sliced profile and ignores invalid dimensions", () => {
    const ferries = [ferry(100, 200, "before"), ferry(1_500, 1_500, "inside")];

    expect(
      buildElevationProfileFerryMarkers(ferries, {
        totalDistanceMeters: 1_000,
        contentWidthPixels: 300,
        distanceOffsetMeters: 1_000,
      }).map((marker) => marker.id),
    ).toEqual(["inside"]);
    expect(
      buildElevationProfileFerryMarkers(ferries, {
        totalDistanceMeters: 0,
        contentWidthPixels: 300,
      }),
    ).toEqual([]);
  });
});
