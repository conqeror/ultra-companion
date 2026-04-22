import { XMLParser } from "fast-xml-parser";
import { computeRouteStats } from "@/utils/geo";
import type { ParsedRoute } from "@/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["Placemark", "coordinates", "LineString", "Point"].includes(name),
});

interface RawCoord {
  latitude: number;
  longitude: number;
  elevation: number | null;
}

function parseCoordinateString(coordStr: string): RawCoord[] {
  return coordStr
    .trim()
    .split(/\s+/)
    .map((tuple) => {
      const parts = tuple.split(",").map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      return {
        longitude: parts[0],
        latitude: parts[1],
        elevation: parts.length >= 3 && !isNaN(parts[2]) ? parts[2] : null,
      } as RawCoord;
    })
    .filter(Boolean) as RawCoord[];
}

function findPlacemarks(obj: any): any[] {
  const results: any[] = [];
  if (!obj || typeof obj !== "object") return results;

  if (obj.Placemark) {
    const pms = Array.isArray(obj.Placemark) ? obj.Placemark : [obj.Placemark];
    results.push(...pms);
  }

  // Recurse into Document, Folder
  for (const key of ["Document", "Folder"]) {
    if (obj[key]) {
      const items = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
      for (const item of items) {
        results.push(...findPlacemarks(item));
      }
    }
  }

  return results;
}

export function parseKML(xml: string, fileName: string): ParsedRoute {
  const parsed = parser.parse(xml);
  const kml = parsed.kml || parsed.KML;
  if (!kml) throw new Error("Invalid KML: missing <kml> root element");

  const placemarks = findPlacemarks(kml);
  let coords: RawCoord[] = [];
  let name = fileName.replace(/\.kml$/i, "");

  for (const pm of placemarks) {
    // LineString (route/track data)
    const lineStrings = pm.LineString
      ? Array.isArray(pm.LineString)
        ? pm.LineString
        : [pm.LineString]
      : [];

    for (const ls of lineStrings) {
      if (ls.coordinates) {
        const coordStr = Array.isArray(ls.coordinates) ? ls.coordinates[0] : ls.coordinates;
        const parsedCoords = parseCoordinateString(String(coordStr));
        if (parsedCoords.length > 0 && coords.length === 0) {
          name = pm.name || name;
        }
        coords.push(...parsedCoords);
      }
    }

    // MultiGeometry
    if (pm.MultiGeometry) {
      const mg = pm.MultiGeometry;
      const mgLines = mg.LineString
        ? Array.isArray(mg.LineString)
          ? mg.LineString
          : [mg.LineString]
        : [];
      for (const ls of mgLines) {
        if (ls.coordinates) {
          const coordStr = Array.isArray(ls.coordinates) ? ls.coordinates[0] : ls.coordinates;
          const parsedCoords = parseCoordinateString(String(coordStr));
          if (parsedCoords.length > 0 && coords.length === 0) {
            name = pm.name || name;
          }
          coords.push(...parsedCoords);
        }
      }
    }
  }

  if (coords.length === 0) {
    throw new Error("KML file contains no route coordinates");
  }

  const stats = computeRouteStats(coords);
  return { name: String(name), ...stats };
}
