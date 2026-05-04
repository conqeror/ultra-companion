import {
  describeDiagnosticText,
  describeSharedPOIInput,
  logSharedPOIDiagnostic,
} from "@/services/sharedPOIDiagnostics";

export interface SharedPOIInput {
  id: string;
  title: string | null;
  text: string | null;
  url: string | null;
  receivedAt: string;
}

export interface SharedPOIDeepLinkInput {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

const PENDING_SHARED_POI_FILE = "pending-poi-share.json";
const SHARE_POI_HOST = "share-poi";

function cleanValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanUnknownString(value: unknown): string | null {
  return typeof value === "string" ? cleanValue(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonUrlLine(text: string | null): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) continue;
    return trimmed;
  }
  return null;
}

function appendParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  const cleaned = cleanValue(value);
  if (cleaned) params.set(key, cleaned);
}

export function buildSharedPOIDeepLink(input: SharedPOIDeepLinkInput): string {
  const params = new URLSearchParams();
  appendParam(params, "title", input.title);
  appendParam(params, "text", input.text);
  appendParam(params, "url", input.url);
  return `ultra://${SHARE_POI_HOST}?${params.toString()}`;
}

export function parseSharedPOIDeepLink(rawUrl: string): SharedPOIInput | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const isSharePOI =
    url.protocol === "ultra:" &&
    (url.hostname === SHARE_POI_HOST || url.pathname.replace(/^\/+/, "") === SHARE_POI_HOST);
  if (!isSharePOI) return null;

  const title = cleanValue(url.searchParams.get("title"));
  const text = cleanValue(url.searchParams.get("text"));
  const sharedUrl = cleanValue(url.searchParams.get("url"));
  if (!title && !text && !sharedUrl) return null;

  return {
    id: `${Date.now()}:${rawUrl}`,
    title,
    text,
    url: sharedUrl,
    receivedAt: new Date().toISOString(),
  };
}

export function parsePendingSharedPOIJSON(rawValue: string): SharedPOIInput | null {
  let data: unknown;
  try {
    data = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (!isRecord(data)) return null;

  const title = cleanUnknownString(data.title);
  const text = cleanUnknownString(data.text);
  const url = cleanUnknownString(data.url);
  if (!title && !text && !url) return null;

  const receivedAt = cleanUnknownString(data.receivedAt) ?? new Date().toISOString();
  return {
    id: `${Date.now()}:app-group:${receivedAt}:${title ?? text ?? url}`,
    title,
    text,
    url,
    receivedAt,
  };
}

export async function loadPendingSharedPOIFromAppGroup(): Promise<SharedPOIInput | null> {
  const { File, Paths } = await import("expo-file-system");
  const containers = Paths.appleSharedContainers;
  logSharedPOIDiagnostic("appGroup.containers", {
    containerIds: Object.keys(containers),
  });
  const containerId = Object.keys(containers).find((id) => id.startsWith("group."));
  if (!containerId) {
    logSharedPOIDiagnostic("appGroup.noContainer");
    return null;
  }

  const pendingFile = new File(containers[containerId], PENDING_SHARED_POI_FILE);
  logSharedPOIDiagnostic("appGroup.pendingFile", {
    containerId,
    fileName: PENDING_SHARED_POI_FILE,
    exists: pendingFile.exists,
  });
  if (!pendingFile.exists) return null;

  let rawValue: string;
  try {
    rawValue = await pendingFile.text();
    logSharedPOIDiagnostic("appGroup.rawPayload", {
      raw: describeDiagnosticText(rawValue),
    });
  } catch (error) {
    logSharedPOIDiagnostic("appGroup.readFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const pendingSharedPOI = parsePendingSharedPOIJSON(rawValue);
  logSharedPOIDiagnostic("appGroup.parsedPayload", {
    sharedPOI: describeSharedPOIInput(pendingSharedPOI),
  });
  try {
    pendingFile.delete();
    logSharedPOIDiagnostic("appGroup.deletedPendingFile");
  } catch (error) {
    logSharedPOIDiagnostic("appGroup.deleteFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return pendingSharedPOI;
}

export function getSharedPOIRawText(input: Pick<SharedPOIInput, "text" | "url" | "title">): string {
  return [input.url, input.text, input.title].filter(Boolean).join("\n");
}

export function getSharedPOIDisplayName(
  input: Pick<SharedPOIInput, "title" | "text">,
): string | null {
  return cleanValue(input.title) ?? firstNonUrlLine(input.text);
}
