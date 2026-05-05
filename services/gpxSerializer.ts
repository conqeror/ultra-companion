import { POI_CATEGORIES } from "@/constants";
import type {
  DisplayPOI,
  POICategory,
  RoutePoint,
  RouteWithPoints,
  StitchedCollection,
} from "@/types";
import { interpolateRoutePointAtDistance } from "@/utils/geo";

export interface GPXSerializerOptions {
  poisAsWaypoints?: DisplayPOI[];
}

const POI_WAYPOINT_SYMBOLS: Record<POICategory, string> = {
  water: "Water",
  groceries: "Food",
  gas_station: "Food",
  bakery: "Food",
  coffee: "Cafe",
  restaurant: "Restaurant",
  bar_pub: "Water",
  toilet_shower: "Generic",
  shelter: "Camping",
  bus_stop: "Camping",
  camp_site: "Camping",
  pharmacy: "Generic",
  hospital_er: "Generic",
  defibrillator: "Generic",
  emergency_phone: "Generic",
  ambulance_station: "Generic",
  bike_shop: "Generic",
  repair_station: "Generic",
  pump_air: "Generic",
  train_station: "Generic",
  sports: "Camping",
  cemetery: "Water",
  school: "Camping",
  other: "Generic",
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function serializeTrackPoint(point: RoutePoint): string {
  const attributes = `lat="${formatCoordinate(point.latitude)}" lon="${formatCoordinate(point.longitude)}"`;

  if (point.elevationMeters == null) {
    return `      <trkpt ${attributes} />`;
  }

  return `      <trkpt ${attributes}>\n        <ele>${point.elevationMeters}</ele>\n      </trkpt>`;
}

function getPoiCategoryLabel(category: POICategory): string {
  return POI_CATEGORIES.find((meta) => meta.key === category)?.label ?? "POI";
}

function formatOffRouteDistance(distanceMeters: number): string {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km off route`;
  }

  return `${Math.round(distanceMeters)} m off route`;
}

function buildWaypointDescription(poi: DisplayPOI): string {
  const parts = [
    `${getPoiCategoryLabel(poi.category)} stop`,
    `Off route: ${Math.round(poi.distanceFromRouteMeters)} m`,
    `POI coordinates: ${formatCoordinate(poi.latitude)}, ${formatCoordinate(poi.longitude)}`,
  ];

  const notes = poi.tags.notes?.trim();
  if (notes) parts.push(`Notes: ${notes}`);

  const address = poi.tags.formatted_address?.trim();
  if (address) parts.push(`Address: ${address}`);

  return parts.join("; ");
}

function serializePOIWaypoint(poi: DisplayPOI, points: RoutePoint[]): string | null {
  const cuePoint = interpolateRoutePointAtDistance(points, poi.effectiveDistanceMeters);
  if (!cuePoint) return null;

  const categoryLabel = getPoiCategoryLabel(poi.category);
  const offRouteSuffix =
    poi.distanceFromRouteMeters > 0
      ? ` (${formatOffRouteDistance(poi.distanceFromRouteMeters)})`
      : "";
  const name = `${poi.name ?? categoryLabel}${offRouteSuffix}`;
  const symbol = POI_WAYPOINT_SYMBOLS[poi.category] ?? "Generic";

  return [
    `  <wpt lat="${formatCoordinate(cuePoint.latitude)}" lon="${formatCoordinate(cuePoint.longitude)}">`,
    `    <name>${escapeXml(name)}</name>`,
    `    <desc>${escapeXml(buildWaypointDescription(poi))}</desc>`,
    `    <sym>${escapeXml(symbol)}</sym>`,
    `    <type>${escapeXml(symbol)}</type>`,
    "  </wpt>",
  ].join("\n");
}

function serializeWaypoints(points: RoutePoint[], options: GPXSerializerOptions): string {
  const waypoints = (options.poisAsWaypoints ?? [])
    .map((poi) => serializePOIWaypoint(poi, points))
    .filter((waypoint): waypoint is string => waypoint != null);

  return waypoints.length > 0 ? `${waypoints.join("\n")}\n` : "";
}

function serializeTrackGPX(
  name: string,
  points: RoutePoint[],
  options: GPXSerializerOptions = {},
): string {
  const trackPoints = points.map(serializeTrackPoint).join("\n");
  const waypoints = serializeWaypoints(points, options);

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ultra Companion" xmlns="http://www.topografix.com/GPX/1/1">
${waypoints}  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

export function serializeRouteToGPX(
  route: RouteWithPoints,
  options: GPXSerializerOptions = {},
): string {
  if (route.points.length === 0) {
    throw new Error("Cannot serialize GPX for route with no points");
  }

  return serializeTrackGPX(route.name, route.points, options);
}

export function serializeCollectionToGPX(
  collectionName: string,
  collection: StitchedCollection,
  options: GPXSerializerOptions = {},
): string {
  if (collection.points.length === 0) {
    throw new Error("Cannot serialize GPX for collection with no points");
  }

  return serializeTrackGPX(collectionName, collection.points, options);
}
