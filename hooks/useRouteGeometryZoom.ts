import { useCallback, useRef, useState } from "react";
import { getMapSimplifyToleranceForZoom } from "@/utils/geo";

export function useRouteGeometryZoom(initialZoom?: number): {
  routeGeometryZoom: number | undefined;
  updateRouteGeometryZoom: (zoom: number) => void;
} {
  const zoomRef = useRef(initialZoom);
  const [routeGeometryZoom, setRouteGeometryZoom] = useState(initialZoom);

  const updateRouteGeometryZoom = useCallback((zoom: number) => {
    if (!Number.isFinite(zoom)) return;

    const currentTolerance = getMapSimplifyToleranceForZoom(zoomRef.current);
    const nextTolerance = getMapSimplifyToleranceForZoom(zoom);
    if (nextTolerance === currentTolerance) return;

    zoomRef.current = zoom;
    setRouteGeometryZoom(zoom);
  }, []);

  return { routeGeometryZoom, updateRouteGeometryZoom };
}
