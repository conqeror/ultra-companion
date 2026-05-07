import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { getMapSimplifyToleranceForZoom } from "@/utils/geo";

export function useRouteGeometryZoom(
  initialZoom?: number,
  initialLatitude?: number,
): {
  routeGeometryToleranceMeters: number;
  updateRouteGeometryZoom: (zoom: number, latitude?: number) => void;
} {
  const { width, height } = useWindowDimensions();
  const cameraRef = useRef({ zoom: initialZoom, latitude: initialLatitude });
  const [routeGeometryToleranceMeters, setRouteGeometryToleranceMeters] = useState(
    getMapSimplifyToleranceForZoom(initialZoom, {
      latitude: initialLatitude,
      viewportWidthPx: width,
      viewportHeightPx: height,
    }),
  );

  useEffect(() => {
    setRouteGeometryToleranceMeters(
      getMapSimplifyToleranceForZoom(cameraRef.current.zoom, {
        latitude: cameraRef.current.latitude,
        viewportWidthPx: width,
        viewportHeightPx: height,
      }),
    );
  }, [height, width]);

  const updateRouteGeometryZoom = useCallback(
    (zoom: number, latitude?: number) => {
      if (!Number.isFinite(zoom)) return;

      const nextLatitude = Number.isFinite(latitude) ? latitude : cameraRef.current.latitude;
      const currentTolerance = getMapSimplifyToleranceForZoom(cameraRef.current.zoom, {
        latitude: cameraRef.current.latitude,
        viewportWidthPx: width,
        viewportHeightPx: height,
      });
      const nextTolerance = getMapSimplifyToleranceForZoom(zoom, {
        latitude: nextLatitude,
        viewportWidthPx: width,
        viewportHeightPx: height,
      });

      cameraRef.current = { zoom, latitude: nextLatitude };
      if (nextTolerance === currentTolerance) return;
      setRouteGeometryToleranceMeters(nextTolerance);
    },
    [height, width],
  );

  return { routeGeometryToleranceMeters, updateRouteGeometryZoom };
}
