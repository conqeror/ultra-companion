import { describe, expect, it } from "vitest";
import { toDisplayDistanceMeters } from "@/services/displayDistance";
import type { DisplayPOI, RoutePoint } from "@/types";
import {
  buildElevationPOIMarkers,
  buildElevationTileDescriptors,
  buildElevationXTicks,
  buildElevationYTicks,
  computeElevationProfileLayout,
  computeElevationYDomain,
  getCenteredElevationScrollOffset,
  getElevationOverviewSeekOffset,
  getElevationOverviewViewport,
  getInitialElevationScrollOffset,
  resolveElevationCurrentPosition,
  scaleElevationDistanceToX,
  scaleElevationToY,
  type ElevationYDomain,
} from "@/utils/elevationProfileModel";
import type { ElevationProfileSample } from "@/utils/elevationProfileSampling";

function sample(distanceMeters: number, elevationMeters: number): ElevationProfileSample {
  return { distanceMeters, elevationMeters };
}

function point(
  idx: number,
  distanceFromStartMeters: number,
  elevationMeters: number | null,
): RoutePoint {
  return {
    idx,
    distanceFromStartMeters,
    elevationMeters,
    latitude: 0,
    longitude: distanceFromStartMeters / 100_000,
  };
}

function poi(id: string, effectiveDistanceMeters: number): DisplayPOI {
  return {
    id,
    sourceId: id,
    source: "osm",
    name: id,
    category: "water",
    latitude: 0,
    longitude: 0,
    tags: {},
    distanceFromRouteMeters: 0,
    distanceAlongRouteMeters: effectiveDistanceMeters,
    effectiveDistanceMeters: toDisplayDistanceMeters(effectiveDistanceMeters),
    routeId: "route",
  };
}

describe("elevation profile model", () => {
  it("keeps 4,000km logical content separate from the visible viewport", () => {
    const layout = computeElevationProfileLayout({
      totalDistanceMeters: 4_000_000,
      widthPixels: 390,
      heightPixels: 240,
    });

    expect(layout).toMatchObject({
      yAxisWidthPixels: 48,
      fitContentWidthPixels: 326,
      desiredContentWidthPixels: 8000,
      contentWidthPixels: 8000,
      viewportWidthPixels: 342,
      pixelsPerMeter: 0.002,
      isScrollable: true,
      overviewShown: true,
      overviewHeightPixels: 52,
      legendHeightPixels: 18,
      mainChartHeightPixels: 170,
      plotHeightPixels: 126,
      axisYPixels: 142,
    });
  });

  it("preserves fit-to-width and climb-right-axis sizing semantics", () => {
    expect(
      computeElevationProfileLayout({
        totalDistanceMeters: 20_000,
        widthPixels: 390,
        heightPixels: 240,
        axisStyle: "climb",
        fitToWidth: true,
        showLegend: false,
      }),
    ).toMatchObject({
      yAxisSide: "right",
      yAxisWidthPixels: 30,
      fitContentWidthPixels: 360,
      contentWidthPixels: 360,
      viewportWidthPixels: 360,
      isScrollable: false,
      overviewShown: false,
      mainChartHeightPixels: 240,
      plotHeightPixels: 196,
    });
  });

  it("computes the SVG-compatible standard and climb Y domains", () => {
    const samples = [sample(0, 100), sample(1000, 200)];

    expect(
      computeElevationYDomain({
        samples,
        contentWidthPixels: 100,
        plotHeightPixels: 120,
      }),
    ).toEqual({
      yMinMeters: 90,
      yMaxMeters: 210,
      dataMinMeters: 100,
      dataMaxMeters: 200,
    });
    expect(
      computeElevationYDomain({
        samples,
        contentWidthPixels: 100,
        plotHeightPixels: 120,
        axisStyle: "climb",
      }),
    ).toEqual({
      yMinMeters: 92,
      yMaxMeters: 212,
      dataMinMeters: 92,
      dataMaxMeters: 212,
    });
  });

  it("builds formatted Y ticks and removes cramped labels", () => {
    const domain: ElevationYDomain = {
      yMinMeters: 90,
      yMaxMeters: 210,
      dataMinMeters: 100,
      dataMaxMeters: 200,
    };
    const ticks = buildElevationYTicks({
      domain,
      plotHeightPixels: 120,
      units: "metric",
    });

    expect(ticks.map(({ valueMeters, label }) => [valueMeters, label])).toEqual([
      [100, "100 m"],
      [120, "120 m"],
      [140, "140 m"],
      [160, "160 m"],
      [180, "180 m"],
      [200, "200 m"],
    ]);

    const cramped = buildElevationYTicks({
      domain,
      plotHeightPixels: 30,
      units: "imperial",
      axisStyle: "climb",
    });
    expect(cramped.every((tick) => !tick.label.includes(" "))).toBe(true);
    expect(
      cramped.every((tick, index) => {
        return index === 0 || cramped[index - 1].yPixels - tick.yPixels >= 18;
      }),
    ).toBe(true);
  });

  it("builds standard, fixed, and climb-specific X ticks", () => {
    const fitted = buildElevationXTicks({
      totalDistanceMeters: 10_000,
      contentWidthPixels: 300,
      units: "metric",
      xAxisLabelOffsetMeters: 1000,
    });
    expect(fitted.map(({ valueMeters, xPixels, label }) => [valueMeters, xPixels, label])).toEqual([
      [0, 0, "1.0 km"],
      [5000, 150, "6.0 km"],
      [10_000, 300, "11.0 km"],
    ]);

    const fixed = buildElevationXTicks({
      totalDistanceMeters: 2500,
      contentWidthPixels: 250,
      units: "metric",
      xTickIntervalMeters: 1000,
    });
    expect(fixed.map((tick) => tick.valueMeters)).toEqual([0, 1000, 2000]);

    const climb = buildElevationXTicks({
      totalDistanceMeters: 2500,
      contentWidthPixels: 250,
      units: "metric",
      axisStyle: "climb",
      xTickIntervalMeters: 1000,
    });
    expect(climb.map(({ valueMeters, label }) => [valueMeters, label])).toEqual([
      [1000, "1"],
      [2000, "2"],
    ]);
  });

  it("maps coordinates and interpolates an explicit current distance", () => {
    const samples = [sample(0, 100), sample(1000, 300)];
    const domain: ElevationYDomain = {
      yMinMeters: 100,
      yMaxMeters: 300,
      dataMinMeters: 100,
      dataMaxMeters: 300,
    };

    expect(scaleElevationDistanceToX(250, 1000, 100)).toBe(25);
    expect(scaleElevationToY(150, domain, 100)).toBe(91);
    expect(
      resolveElevationCurrentPosition({
        samples,
        points: [point(0, 0, 100), point(1, 1000, null)],
        totalDistanceMeters: 1000,
        contentWidthPixels: 100,
        plotHeightPixels: 100,
        domain,
        currentDistanceMeters: 250,
        currentPointIndex: 1,
      }),
    ).toEqual({
      distanceMeters: 250,
      elevationMeters: 150,
      xPixels: 25,
      yPixels: 91,
    });
  });

  it("treats an invalid explicit current distance as authoritative", () => {
    expect(
      resolveElevationCurrentPosition({
        samples: [sample(0, 100), sample(1000, 300)],
        points: [point(0, 0, 100)],
        totalDistanceMeters: 1000,
        contentWidthPixels: 100,
        plotHeightPixels: 100,
        domain: {
          yMinMeters: 100,
          yMaxMeters: 300,
          dataMinMeters: 100,
          dataMaxMeters: 300,
        },
        currentDistanceMeters: Number.POSITIVE_INFINITY,
        currentPointIndex: 0,
      }),
    ).toBeNull();
  });

  it("sorts POIs, stacks close markers, and clamps the stack to the plot top", () => {
    const markers = buildElevationPOIMarkers({
      pois: [poi("outside", 1500), poi("c", 250), poi("a", 100), poi("b", 200)],
      samples: [sample(0, 100), sample(1000, 200)],
      totalDistanceMeters: 1000,
      contentWidthPixels: 100,
      plotHeightPixels: 100,
      domain: {
        yMinMeters: 0,
        yMaxMeters: 200,
        dataMinMeters: 100,
        dataMaxMeters: 200,
      },
    });

    expect(markers.map((marker) => marker.poi.id)).toEqual(["a", "b", "c"]);
    expect(markers.map((marker) => marker.xPixels)).toEqual([10, 20, 25]);
    expect(markers[0].yPixels).toBeCloseTo(47);
    expect(markers[1].yPixels).toBeCloseTo(31);
    expect(markers[2].yPixels).toBe(24);
    expect(markers[0]).toMatchObject({
      elevationMeters: 110,
      color: "#3B82F6",
      iconName: "Droplets",
    });
  });

  it("describes only visible and overscanned tiles, including a clipped last tile", () => {
    const samples = [0, 1000, 2000, 3000, 4000, 5000, 6000].map((distance) =>
      sample(distance, distance / 10),
    );
    const tiles = buildElevationTileDescriptors({
      contentWidthPixels: 3000,
      viewportWidthPixels: 390,
      scrollOffsetPixels: 2800,
      contentStartDistanceMeters: 0,
      contentEndDistanceMeters: 6000,
      tileWidthPixels: 512,
      overscanTiles: 1,
      samples,
    });

    expect(tiles.map(({ index, xPixels, widthPixels }) => [index, xPixels, widthPixels])).toEqual([
      [4, 2048, 512],
      [5, 2560, 440],
    ]);
    expect(tiles[0]).toMatchObject({
      startDistanceMeters: 4096,
      endDistanceMeters: 5120,
      sampleIndexRange: { startIndex: 4, endIndexExclusive: 7 },
    });
    expect(tiles[1]).toMatchObject({
      startDistanceMeters: 5120,
      endDistanceMeters: 6000,
      sampleIndexRange: { startIndex: 5, endIndexExclusive: 7 },
    });
  });

  it("maps initial centering and overview scrubbing to the same detail offset", () => {
    const centered = getCenteredElevationScrollOffset({
      contentX: 4000,
      contentWidthPixels: 8000,
      viewportWidthPixels: 342,
    });
    const initial = getInitialElevationScrollOffset({
      currentDistanceMeters: 2_000_000,
      totalDistanceMeters: 4_000_000,
      contentWidthPixels: 8000,
      viewportWidthPixels: 342,
    });
    const sought = getElevationOverviewSeekOffset({
      touchXPixels: 211,
      overviewWidthPixels: 390,
      contentWidthPixels: 8000,
      viewportWidthPixels: 342,
    });

    expect(centered).toBe(3829);
    expect(initial).toBe(centered);
    expect(sought).toBe(centered);
    expect(
      getElevationOverviewSeekOffset({
        touchXPixels: 10_000,
        overviewWidthPixels: 390,
        contentWidthPixels: 8000,
        viewportWidthPixels: 342,
      }),
    ).toBe(7658);
  });

  it("maps a clamped detail viewport into overview coordinates", () => {
    const indicator = getElevationOverviewViewport({
      scrollOffsetPixels: 3829,
      overviewWidthPixels: 390,
      contentWidthPixels: 8000,
      viewportWidthPixels: 342,
    });

    expect(indicator.xPixels).toBeCloseTo(204.032, 3);
    expect(indicator.widthPixels).toBeCloseTo(13.9365, 3);
  });
});
