import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseMocks } from "@/tests/mocks/database";
import type { CollectionSegment, StitchedCollection } from "@/types";

const { stitchCollectionMock } = vi.hoisted(() => ({
  stitchCollectionMock: vi.fn(),
}));

vi.mock("@/services/stitchingService", () => ({
  stitchCollection: stitchCollectionMock,
}));

import { useCollectionStore } from "@/store/collectionStore";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function segment(routeId: string): CollectionSegment {
  return {
    collectionId: "c1",
    routeId,
    position: 0,
    isSelected: true,
    variantKind: "full",
    baseRouteId: null,
    replaceStartDistanceMeters: null,
    replaceEndDistanceMeters: null,
  };
}

function stitched(routeId: string, totalDistanceMeters: number): StitchedCollection {
  return {
    collectionId: "c1",
    points: [],
    segments: [],
    totalDistanceMeters,
    totalAscentMeters: 0,
    totalDescentMeters: 0,
    pointsByRouteId: { [routeId]: [] },
    sourceSpans: [],
  };
}

describe("collectionStore active stitch generation", () => {
  beforeEach(() => {
    stitchCollectionMock.mockReset();
    useCollectionStore.setState({
      collections: [
        {
          id: "c1",
          name: "Collection",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          plannedStartMs: null,
        },
      ],
      activeStitchedCollection: null,
      activeStitchedFingerprint: null,
      assignedRouteIds: new Set<string>(),
      isLoading: false,
    });
  });

  it("does not let an obsolete stitch overwrite a newer variant result", async () => {
    const first = deferred<StitchedCollection>();
    const second = deferred<StitchedCollection>();
    databaseMocks.getCollectionSegments.mockResolvedValue([segment("route-a")]);
    stitchCollectionMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const firstRequest = useCollectionStore.getState().loadStitchedCollection("c1");
    await vi.waitFor(() => expect(stitchCollectionMock).toHaveBeenCalledTimes(1));

    databaseMocks.getCollectionSegments.mockResolvedValue([segment("route-b")]);
    const secondRequest = useCollectionStore.getState().loadStitchedCollection("c1");
    await vi.waitFor(() => expect(stitchCollectionMock).toHaveBeenCalledTimes(2));

    const firstOptions = stitchCollectionMock.mock.calls[0][1];
    const secondOptions = stitchCollectionMock.mock.calls[1][1];
    expect(firstOptions.shouldCancel()).toBe(true);
    expect(secondOptions.shouldCancel()).toBe(false);

    second.resolve(stitched("route-b", 2_000));
    await secondRequest;
    expect(useCollectionStore.getState().activeStitchedCollection?.totalDistanceMeters).toBe(2_000);

    first.resolve(stitched("route-a", 1_000));
    await firstRequest;
    expect(useCollectionStore.getState().activeStitchedCollection?.totalDistanceMeters).toBe(2_000);
  });

  it("does not publish stitched data for a different active collection", async () => {
    useCollectionStore.setState({
      collections: [
        {
          id: "c2",
          name: "Other collection",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          plannedStartMs: null,
        },
      ],
    });
    databaseMocks.getCollectionSegments.mockResolvedValue([segment("route-a")]);
    stitchCollectionMock.mockResolvedValue(stitched("route-a", 1_000));

    await useCollectionStore.getState().loadStitchedCollection("c1");

    expect(useCollectionStore.getState().activeStitchedCollection).toBeNull();
    expect(useCollectionStore.getState().activeStitchedFingerprint).toBeNull();
  });

  it("treats active metadata as authoritative over stale stitched data", async () => {
    useCollectionStore.setState({
      collections: [
        {
          id: "c2",
          name: "Other collection",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          plannedStartMs: null,
        },
      ],
      activeStitchedCollection: stitched("route-a", 1_000),
    });

    await useCollectionStore.getState().selectVariant("c1", "route-b");

    expect(databaseMocks.selectVariant).toHaveBeenCalledWith("c1", "route-b");
    expect(stitchCollectionMock).not.toHaveBeenCalled();
  });

  it("does not publish when selected segments change during stitching", async () => {
    databaseMocks.getCollectionSegments
      .mockResolvedValueOnce([segment("route-a")])
      .mockResolvedValueOnce([segment("route-b")]);
    stitchCollectionMock.mockResolvedValue(stitched("route-a", 1_000));

    await useCollectionStore.getState().loadStitchedCollection("c1");

    expect(stitchCollectionMock).toHaveBeenCalledTimes(1);
    expect(useCollectionStore.getState().activeStitchedCollection).toBeNull();
    expect(useCollectionStore.getState().activeStitchedFingerprint).toBeNull();
  });
});
