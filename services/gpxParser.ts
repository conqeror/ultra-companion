import { XMLParser } from "fast-xml-parser";
import { computeRouteStats } from "@/utils/geo";
import type { ParsedRoute } from "@/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["trk", "trkseg", "trkpt", "rte", "rtept", "wpt"].includes(name),
});

interface RawCoord {
  latitude: number;
  longitude: number;
  elevation: number | null;
}

function parseFloat0(val: unknown): number | null {
  if (val == null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function extractPointsFromTrk(trk: any): RawCoord[] {
  const coords: RawCoord[] = [];
  const segments = Array.isArray(trk.trkseg) ? trk.trkseg : trk.trkseg ? [trk.trkseg] : [];

  for (const seg of segments) {
    const pts = Array.isArray(seg.trkpt) ? seg.trkpt : seg.trkpt ? [seg.trkpt] : [];
    for (const pt of pts) {
      const lat = parseFloat0(pt["@_lat"]);
      const lon = parseFloat0(pt["@_lon"]);
      if (lat != null && lon != null) {
        coords.push({ latitude: lat, longitude: lon, elevation: parseFloat0(pt.ele) });
      }
    }
  }
  return coords;
}

function extractPointsFromRte(rte: any): RawCoord[] {
  const pts = Array.isArray(rte.rtept) ? rte.rtept : rte.rtept ? [rte.rtept] : [];
  return pts
    .map((pt: any) => {
      const lat = parseFloat0(pt["@_lat"]);
      const lon = parseFloat0(pt["@_lon"]);
      if (lat == null || lon == null) return null;
      return { latitude: lat, longitude: lon, elevation: parseFloat0(pt.ele) };
    })
    .filter(Boolean) as RawCoord[];
}

export function parseGPX(xml: string, fileName: string): ParsedRoute {
  const parsed = parser.parse(xml);
  const gpx = parsed.gpx;
  if (!gpx) throw new Error("Invalid GPX: missing <gpx> root element");

  let coords: RawCoord[] = [];
  let name = fileName.replace(/\.gpx$/i, "");

  // Try tracks first (most common)
  const tracks = Array.isArray(gpx.trk) ? gpx.trk : gpx.trk ? [gpx.trk] : [];
  if (tracks.length > 0) {
    name = tracks[0].name || name;
    for (const trk of tracks) {
      coords.push(...extractPointsFromTrk(trk));
    }
  }

  // Fallback to routes
  if (coords.length === 0) {
    const routes = Array.isArray(gpx.rte) ? gpx.rte : gpx.rte ? [gpx.rte] : [];
    if (routes.length > 0) {
      name = routes[0].name || name;
      for (const rte of routes) {
        coords.push(...extractPointsFromRte(rte));
      }
    }
  }

  if (coords.length === 0) {
    throw new Error("GPX file contains no track or route points");
  }

  const stats = computeRouteStats(coords);
  return { name: String(name), ...stats };
}
