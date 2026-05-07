import { describe, expect, it } from "vitest";
import {
  bucketDistanceForDerivedWork,
  distanceBucketKey,
  WEATHER_PROGRESS_BUCKET_METERS,
} from "@/utils/distanceBuckets";

describe("distanceBuckets", () => {
  it("keeps expensive derived work stable inside a progress bucket", () => {
    expect(bucketDistanceForDerivedWork(null)).toBeNull();
    expect(bucketDistanceForDerivedWork(0)).toBe(0);
    expect(bucketDistanceForDerivedWork(99.9)).toBe(0);
    expect(bucketDistanceForDerivedWork(100)).toBe(100);
    expect(bucketDistanceForDerivedWork(10_499, WEATHER_PROGRESS_BUCKET_METERS)).toBe(10_000);
  });

  it("builds dependency keys for weather and timeline gates", () => {
    expect(distanceBucketKey(null)).toBe("none");
    expect(distanceBucketKey(10_499, WEATHER_PROGRESS_BUCKET_METERS)).toBe("10000");
  });

  it("lets climb and panel derivations use coarse custom progress buckets", () => {
    expect(bucketDistanceForDerivedWork(1_099, 500)).toBe(1_000);
    expect(bucketDistanceForDerivedWork(1_499, 500)).toBe(1_000);
    expect(bucketDistanceForDerivedWork(1_500, 500)).toBe(1_500);
  });
});
