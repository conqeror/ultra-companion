import { processRouteElevations } from "@/utils/elevation";
import type { KeyValueStorage } from "@/lib/keyValueStorage";

export const ELEVATION_PROCESSOR_VERSION = 1;

let storageInstance: KeyValueStorage | null = null;

async function getStorage() {
  if (!storageInstance) {
    const { createKeyValueStorage } = await import("@/lib/keyValueStorage");
    storageInstance = createKeyValueStorage("elevation-processor");
  }
  return storageInstance;
}

export async function reprocessElevationsIfNeeded(): Promise<number> {
  const storage = await getStorage();
  const storedVersion = storage.getNumber("version") ?? 0;
  if (storedVersion >= ELEVATION_PROCESSOR_VERSION) return 0;

  const { getAllRoutes, getRoutePoints, updateRouteElevationData } = await import("@/db/database");
  const routes = await getAllRoutes();
  let updatedCount = 0;

  for (const route of routes) {
    const points = await getRoutePoints(route.id);
    if (points.length === 0) continue;

    const processed = processRouteElevations(points);
    await updateRouteElevationData(route.id, processed.points, {
      totalAscentMeters: processed.totalAscentMeters,
      totalDescentMeters: processed.totalDescentMeters,
    });
    updatedCount++;
  }

  storage.set("version", ELEVATION_PROCESSOR_VERSION);

  if (updatedCount > 0) {
    const [{ clearRouteEtaCaches }, { useEtaStore }, { useRouteStore }, { useClimbStore }] =
      await Promise.all([
        import("@/services/etaCalculator"),
        import("@/store/etaStore"),
        import("@/store/routeStore"),
        import("@/store/climbStore"),
      ]);

    clearRouteEtaCaches();
    await useEtaStore.getState().clearRelativeETACache();
    useRouteStore.setState({ visibleRoutePoints: {} });
    useClimbStore.getState().clearClimbCache();
    await useRouteStore.getState().loadRouteMetadata();
  }

  return updatedCount;
}
