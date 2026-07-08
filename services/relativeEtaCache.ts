import type {
  PowerModelConfig,
  RelativeETAProgress,
  RelativeETAScope,
  RoutePoint,
  StitchedSegmentInfo,
} from "@/types";
import {
  getRelativeETACache,
  upsertRelativeETACache,
  deleteRelativeETACache,
  clearRelativeETACaches,
} from "@/db/database";
import { computeSegmentTime } from "@/services/powerModel";
import { powerConfigKey } from "@/services/etaCalculator";
import { computeWindowedGradient } from "@/utils/elevation";

export const ETA_ALGORITHM_VERSION = 1;

const DEFAULT_COMPUTE_CHUNK_POINTS = 2_500;

export interface RelativeETAInput {
  scope: RelativeETAScope;
  scopeId: string;
  points: RoutePoint[];
  totalDistanceMeters?: number | null;
  totalAscentMeters?: number | null;
  totalDescentMeters?: number | null;
  segmentsSignature?: string | null;
}

export interface RelativeETACacheDescriptor {
  cacheKey: string;
  scope: RelativeETAScope;
  scopeId: string;
  signature: string;
  powerConfigKey: string;
  algorithmVersion: number;
  pointCount: number;
}

interface ComputeRelativeETAOptions {
  chunkPoints?: number;
  onProgress?: (progress: RelativeETAProgress) => void;
}

function round(value: number | null | undefined, precision = 1): string {
  if (value == null || !Number.isFinite(value)) return "n";
  const scale = 10 ** precision;
  return String(Math.round(value * scale) / scale);
}

function pointPart(point: RoutePoint | undefined): string {
  if (!point) return "none";
  return [
    point.idx,
    round(point.distanceFromStartMeters, 1),
    round(point.latitude, 6),
    round(point.longitude, 6),
    round(point.elevationMeters, 1),
  ].join(":");
}

export function stitchedSegmentsCacheSignature(
  segments: readonly StitchedSegmentInfo[] | null | undefined,
): string {
  if (!segments?.length) return "none";
  return segments
    .map((segment) =>
      [
        segment.position,
        segment.routeId,
        segment.variantKind,
        segment.baseRouteId ?? "base:none",
        round(segment.replaceStartDistanceMeters, 1),
        round(segment.replaceEndDistanceMeters, 1),
        round(segment.distanceOffsetMeters, 1),
        round(segment.segmentDistanceMeters, 1),
        round(segment.segmentAscentMeters, 1),
        round(segment.segmentDescentMeters, 1),
      ].join(":"),
    )
    .join("|");
}

function buildRouteSignature(input: RelativeETAInput): string {
  const { points } = input;
  const last = points[points.length - 1];
  const quarter = points[Math.floor((points.length - 1) * 0.25)];
  const middle = points[Math.floor((points.length - 1) * 0.5)];
  const threeQuarter = points[Math.floor((points.length - 1) * 0.75)];

  return [
    `scope:${input.scope}`,
    `id:${input.scopeId}`,
    `points:${points.length}`,
    `distance:${round(input.totalDistanceMeters ?? last?.distanceFromStartMeters, 1)}`,
    `ascent:${round(input.totalAscentMeters, 1)}`,
    `descent:${round(input.totalDescentMeters, 1)}`,
    `first:${pointPart(points[0])}`,
    `q1:${pointPart(quarter)}`,
    `mid:${pointPart(middle)}`,
    `q3:${pointPart(threeQuarter)}`,
    `last:${pointPart(last)}`,
    `segments:${input.segmentsSignature ?? "none"}`,
  ].join("|");
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildRelativeETACacheDescriptor(
  input: RelativeETAInput,
  config: PowerModelConfig,
): RelativeETACacheDescriptor {
  const signature = buildRouteSignature(input);
  const configKey = powerConfigKey(config);
  const cacheHash = hashString(`${signature}|power:${configKey}|algo:${ETA_ALGORITHM_VERSION}`);

  return {
    cacheKey: `relative-eta:${ETA_ALGORITHM_VERSION}:${input.scope}:${input.scopeId}:${cacheHash}`,
    scope: input.scope,
    scopeId: input.scopeId,
    signature,
    powerConfigKey: configKey,
    algorithmVersion: ETA_ALGORITHM_VERSION,
    pointCount: input.points.length,
  };
}

export function encodeCumulativeSeconds(cumulativeSeconds: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(cumulativeSeconds.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < cumulativeSeconds.length; i++) {
    const value = cumulativeSeconds[i];
    view.setFloat32(i * 4, Number.isFinite(value) ? value : 0, true);
  }
  return bytes;
}

export function decodeCumulativeSeconds(bytes: Uint8Array, pointCount: number): number[] | null {
  if (bytes.byteLength !== pointCount * 4) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cumulative = Array.from<number>({ length: pointCount });
  for (let i = 0; i < pointCount; i++) {
    cumulative[i] = view.getFloat32(i * 4, true);
  }
  return cumulative;
}

export async function loadRelativeETACache(
  descriptor: RelativeETACacheDescriptor,
): Promise<number[] | null> {
  let cached: Awaited<ReturnType<typeof getRelativeETACache>>;
  try {
    cached = await getRelativeETACache(descriptor.cacheKey);
  } catch (error) {
    console.warn("Failed to read relative ETA cache; computing from route points instead:", error);
    return null;
  }
  if (!cached) return null;
  if (
    cached.scope !== descriptor.scope ||
    cached.scopeId !== descriptor.scopeId ||
    cached.signature !== descriptor.signature ||
    cached.powerConfigKey !== descriptor.powerConfigKey ||
    cached.algorithmVersion !== descriptor.algorithmVersion ||
    cached.pointCount !== descriptor.pointCount
  ) {
    return null;
  }

  return decodeCumulativeSeconds(cached.cumulativeSeconds, descriptor.pointCount);
}

export async function persistRelativeETACache(
  descriptor: RelativeETACacheDescriptor,
  cumulativeSeconds: number[],
): Promise<void> {
  if (cumulativeSeconds.length !== descriptor.pointCount) return;

  try {
    await upsertRelativeETACache({
      cacheKey: descriptor.cacheKey,
      scope: descriptor.scope,
      scopeId: descriptor.scopeId,
      signature: descriptor.signature,
      powerConfigKey: descriptor.powerConfigKey,
      algorithmVersion: descriptor.algorithmVersion,
      pointCount: descriptor.pointCount,
      totalDurationSeconds: cumulativeSeconds[cumulativeSeconds.length - 1] ?? 0,
      cumulativeSeconds: encodeCumulativeSeconds(cumulativeSeconds),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(
      "Failed to persist relative ETA cache; using in-memory ETA for this session:",
      error,
    );
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function computeRouteETAInChunks(
  points: RoutePoint[],
  config: PowerModelConfig,
  options: ComputeRelativeETAOptions = {},
): Promise<number[]> {
  if (points.length === 0) return [];

  const chunkPoints = Math.max(1, options.chunkPoints ?? DEFAULT_COMPUTE_CHUNK_POINTS);
  const cumulative = Array.from<number>({ length: points.length });
  cumulative[0] = 0;
  options.onProgress?.({ computedPoints: 1, totalPoints: points.length });

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dist = curr.distanceFromStartMeters - prev.distanceFromStartMeters;
    const gradient = computeWindowedGradient(points, i);

    cumulative[i] = cumulative[i - 1] + computeSegmentTime(dist, gradient, config);

    if (i % chunkPoints === 0) {
      options.onProgress?.({ computedPoints: i + 1, totalPoints: points.length });
      await yieldToEventLoop();
    }
  }

  options.onProgress?.({ computedPoints: points.length, totalPoints: points.length });
  return cumulative;
}

export { clearRelativeETACaches, deleteRelativeETACache };
