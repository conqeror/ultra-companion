export const DERIVED_PROGRESS_BUCKET_METERS = 100;
export const WEATHER_PROGRESS_BUCKET_METERS = 10_000;

export function bucketDistanceForDerivedWork(
  distanceMeters: number | null | undefined,
  bucketMeters = DERIVED_PROGRESS_BUCKET_METERS,
): number | null {
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return null;
  if (bucketMeters <= 0 || !Number.isFinite(bucketMeters)) return Math.max(0, distanceMeters);
  return Math.floor(Math.max(0, distanceMeters) / bucketMeters) * bucketMeters;
}

export function distanceBucketKey(
  distanceMeters: number | null | undefined,
  bucketMeters = DERIVED_PROGRESS_BUCKET_METERS,
): string {
  return bucketDistanceForDerivedWork(distanceMeters, bucketMeters)?.toString() ?? "none";
}
