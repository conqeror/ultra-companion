import type { POI } from "@/types";

const ADDRESS_TAG_KEYS = [
  "formatted_address",
  "addr:street",
  "addr:housenumber",
  "addr:city",
  "addr:postcode",
  "addr:country",
];
const PHONE_TAG_KEYS = ["phone", "contact:phone"];
const WEBSITE_TAG_KEYS = ["website", "contact:website", "url"];
const EXTRA_DETAIL_TAGS: Array<{ key: string; label: string }> = [
  { key: "operator", label: "Operator" },
  { key: "brand", label: "Brand" },
  { key: "description", label: "Details" },
  { key: "description:en", label: "Details" },
  { key: "note", label: "Note" },
  { key: "fee", label: "Fee" },
  { key: "wheelchair", label: "Wheelchair" },
  { key: "drinking_water", label: "Drinking water" },
];

export interface PoiDetailField {
  label: string;
  value: string;
}

function cleanTagValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getPoiMapUrl(poi: POI): string {
  if (poi.tags?.google_maps_url) return poi.tags.google_maps_url;
  const query = encodeURIComponent(`${poi.latitude},${poi.longitude}`);
  if (poi.tags?.google_place_id) {
    const placeId = encodeURIComponent(poi.tags.google_place_id);
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export function buildPhoneUrl(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/(?!^\+)\D/g, "");
  return normalized ? `tel:${normalized}` : null;
}

export function getPoiAddress(poi: POI): string | null {
  const t = poi.tags;
  const formatted = cleanTagValue(t.formatted_address);
  if (formatted) return formatted;

  const street = cleanTagValue(t["addr:street"]);
  const houseNumber = cleanTagValue(t["addr:housenumber"]);
  const city = cleanTagValue(t["addr:city"]);
  const postcode = cleanTagValue(t["addr:postcode"]);
  const country = cleanTagValue(t["addr:country"]);

  const parts: string[] = [];
  if (street) parts.push(`${street}${houseNumber ? ` ${houseNumber}` : ""}`);
  if (postcode || city) parts.push([postcode, city].filter(Boolean).join(" "));
  if (country) parts.push(country);

  return parts.length > 0 ? parts.join(", ") : null;
}

export function getPoiPhone(poi: POI): string | null {
  for (const key of PHONE_TAG_KEYS) {
    const value = cleanTagValue(poi.tags[key]);
    if (value) return value;
  }
  return null;
}

export function getPoiWebsiteUrl(poi: POI): string | null {
  for (const key of WEBSITE_TAG_KEYS) {
    const value = cleanTagValue(poi.tags[key]);
    if (!value) continue;
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }
  return null;
}

export function getPoiExtraDetailFields(poi: POI): PoiDetailField[] {
  const seenLabels = new Set<string>();
  const fields: PoiDetailField[] = [];

  for (const { key, label } of EXTRA_DETAIL_TAGS) {
    const value = cleanTagValue(poi.tags[key]);
    if (!value || seenLabels.has(label)) continue;
    fields.push({ label, value });
    seenLabels.add(label);
  }

  return fields;
}

export function hasExpandablePoiDetails(poi: POI): boolean {
  if (cleanTagValue(poi.tags.opening_hours)) return true;
  if (getPoiAddress(poi)) return true;
  if (getPoiPhone(poi)) return true;
  if (getPoiWebsiteUrl(poi)) return true;
  if (getPoiExtraDetailFields(poi).length > 0) return true;

  return ADDRESS_TAG_KEYS.some((key) => Boolean(cleanTagValue(poi.tags[key])));
}
