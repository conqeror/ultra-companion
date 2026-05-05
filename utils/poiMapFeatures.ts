import { POI_CATEGORIES, poiMapIconImageId } from "@/constants";
import type { DisplayPOI, POICategory } from "@/types";

const categoryColorMap = Object.fromEntries(POI_CATEGORIES.map((c) => [c.key, c.color]));
const categoryIconMap = Object.fromEntries(POI_CATEGORIES.map((c) => [c.key, c.iconName]));

export interface POIMapFeatureProperties {
  poiId: string;
  category: POICategory;
  color: string;
  iconImage: string;
  name: string;
  starred: 0 | 1;
}

export type POIMapFeature = GeoJSON.Feature<GeoJSON.Point, POIMapFeatureProperties>;
export type POIMapFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  POIMapFeatureProperties
>;

export interface POIMapFeatureCollections {
  clustered: POIMapFeatureCollection;
  starred: POIMapFeatureCollection;
}

function emptyFeatureCollection(): POIMapFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export function buildPOIMapFeature(poi: DisplayPOI, starred: boolean): POIMapFeature {
  const color = categoryColorMap[poi.category] ?? "#888888";

  return {
    type: "Feature",
    properties: {
      poiId: poi.id,
      category: poi.category,
      color,
      iconImage: poiMapIconImageId(categoryIconMap[poi.category] ?? "MapPin"),
      name: poi.name ?? "",
      starred: starred ? 1 : 0,
    },
    geometry: {
      type: "Point",
      coordinates: [poi.longitude, poi.latitude],
    },
  };
}

export function buildPOIMapFeatureCollections(
  pois: DisplayPOI[],
  starredPOIIds: ReadonlySet<string>,
): POIMapFeatureCollections {
  const clustered = emptyFeatureCollection();
  const starred = emptyFeatureCollection();

  for (const poi of pois) {
    const isStarred = starredPOIIds.has(poi.id);
    const feature = buildPOIMapFeature(poi, isStarred);
    if (isStarred) {
      starred.features.push(feature);
    } else {
      clustered.features.push(feature);
    }
  }

  return { clustered, starred };
}
