import type {
  BRouterAlternativeIndex,
  BRouterProfile,
  ParsedRoute,
  RoutingWaypoint,
} from "@/types";
import { computeRouteStats } from "@/utils/geo";
import { validateBRouterProfile } from "@/services/brouterProfiles";

const BROUTER_URL = "https://brouter.de/brouter";
const REQUEST_TIMEOUT_MS = 60_000;

function linkedRequestController(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  return {
    controller,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

export function isRoutingWaypoint(value: RoutingWaypoint): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Validate the provider boundary before feeding geometry into local route calculations. */
export function parseBRouterRoute(value: unknown): ParsedRoute {
  const collection = record(value);
  const features = collection?.features;
  const routes = Array.isArray(features)
    ? features.filter((feature) => record(record(feature)?.geometry)?.type === "LineString")
    : [];
  const coordinates = record(record(routes[0])?.geometry)?.coordinates;
  if (
    collection?.type !== "FeatureCollection" ||
    routes.length !== 1 ||
    !Array.isArray(coordinates) ||
    coordinates.length < 2
  ) {
    throw new Error("BRouter returned no usable route. Try different points.");
  }
  const coords = coordinates.map((coordinate: unknown) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !isRoutingWaypoint({ longitude: coordinate[0], latitude: coordinate[1] }) ||
      (coordinate[2] != null && !Number.isFinite(coordinate[2]))
    ) {
      throw new Error("BRouter returned invalid route coordinates. Try again.");
    }
    return {
      longitude: coordinate[0] as number,
      latitude: coordinate[1] as number,
      elevation: (coordinate[2] ?? null) as number | null,
    };
  });
  const stats = computeRouteStats(coords);
  if (stats.totalDistanceMeters <= 0) {
    throw new Error("These points lead to the same place. Choose a different destination.");
  }
  return { name: "Planned route", ...stats };
}

/** Upload a custom profile once so a comparison batch can reuse its temporary provider ID. */
export async function uploadBRouterProfile(
  profile: BRouterProfile,
  signal?: AbortSignal,
): Promise<string> {
  validateBRouterProfile(profile.name, profile.content);
  const request = linkedRequestController(signal);
  try {
    const upload = await fetch(`${BROUTER_URL}/profile`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: profile.content,
      signal: request.controller.signal,
    });
    if (!upload.ok) throw new Error("Could not upload the BRouter profile. Try again shortly.");
    let uploaded: Record<string, unknown> | null;
    try {
      uploaded = record(await upload.json());
    } catch {
      throw new Error("BRouter could not read this profile. Check its contents in Settings.");
    }
    if (typeof uploaded?.error === "string" && uploaded.error) {
      throw new Error(`BRouter rejected “${profile.name}”: ${uploaded.error.slice(0, 400)}`);
    }
    if (
      typeof uploaded?.profileid !== "string" ||
      !/^custom_[a-zA-Z0-9_-]+$/.test(uploaded.profileid)
    ) {
      throw new Error("BRouter returned an invalid profile response. Try again.");
    }
    return uploaded.profileid;
  } catch (error) {
    if (request.didTimeOut()) {
      throw new Error("Uploading the BRouter profile took too long. Try again.", { cause: error });
    }
    if (signal?.aborted) throw error;
    if (error instanceof TypeError) {
      throw new Error(
        "Could not connect to BRouter. Check your internet connection and try again.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    request.dispose();
  }
}

export async function fetchBRouterRoute(
  waypoints: readonly RoutingWaypoint[],
  signal?: AbortSignal,
  profile?: BRouterProfile | null,
  alternativeIndex: BRouterAlternativeIndex = 0,
  uploadedProfileId?: string,
): Promise<ParsedRoute> {
  if (waypoints.length < 2 || !waypoints.every(isRoutingWaypoint)) {
    throw new Error("Choose at least two valid points on the map.");
  }
  if (profile) validateBRouterProfile(profile.name, profile.content);
  if (![0, 1, 2, 3].includes(alternativeIndex)) {
    throw new Error("BRouter alternative index must be between 0 and 3.");
  }
  if (uploadedProfileId && !/^custom_[a-zA-Z0-9_-]+$/.test(uploadedProfileId)) {
    throw new Error("BRouter profile ID is invalid.");
  }
  const request = linkedRequestController(signal);
  try {
    let profileId = "fastbike";
    if (profile) {
      // Reuse one upload within a comparison batch. Outside a batch, upload fresh
      // source so edits take effect and expired provider IDs are never persisted.
      profileId =
        uploadedProfileId ?? (await uploadBRouterProfile(profile, request.controller.signal));
    }
    if (request.controller.signal.aborted) throw new Error("Routing cancelled.");
    const lonlats = waypoints.map((p) => `${p.longitude},${p.latitude}`).join("|");
    const response = await fetch(
      `${BROUTER_URL}?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profileId)}&alternativeidx=${alternativeIndex}&format=geojson`,
      { signal: request.controller.signal },
    );
    if (!response.ok) {
      throw new Error(
        response.status >= 500 || response.status === 429
          ? "BRouter is busy or unavailable. Try again shortly."
          : "No cycling route found. Undo the last point or try a shorter route.",
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error("BRouter returned an unreadable route. Try again.");
    }
    return parseBRouterRoute(json);
  } catch (error) {
    if (request.didTimeOut())
      throw new Error("Routing took too long. Try again or plan a shorter section.", {
        cause: error,
      });
    if (signal?.aborted) throw error;
    if (error instanceof TypeError) {
      throw new Error(
        "Could not connect to BRouter. Check your internet connection and try again.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    request.dispose();
  }
}
