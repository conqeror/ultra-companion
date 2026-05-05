import { describe, expect, it, vi } from "vitest";

const { shareMock } = vi.hoisted(() => ({ shareMock: vi.fn() }));

vi.mock("expo-file-system", () => ({
  File: class MockFile {
    uri: string;

    constructor(cache: string, filename: string) {
      this.uri = `${cache}/${filename}`;
    }

    write = vi.fn();
  },
  Paths: { cache: "cache" },
}));

vi.mock("react-native", () => ({
  Share: { share: shareMock },
}));

import { getSafeGPXFilename, shareGPXFile } from "@/utils/gpxExportShare";

describe("gpxExportShare", () => {
  it("sanitizes export filenames and keeps an existing GPX extension", () => {
    expect(getSafeGPXFilename("Race Segment 01")).toBe("Race_Segment_01.gpx");
    expect(getSafeGPXFilename("route.GPX")).toBe("route.GPX");
    expect(getSafeGPXFilename("")).toBe("ultra-route.gpx");
  });

  it("writes a GPX file to cache and opens the share sheet", async () => {
    shareMock.mockResolvedValueOnce({ action: "sharedAction" });

    await shareGPXFile("<gpx />", "My Route");

    expect(shareMock).toHaveBeenCalledWith({
      url: "cache/My_Route.gpx",
      title: "My_Route.gpx",
    });
  });
});
