import {
  createPlanningDatabaseExport,
  importPlanningDatabaseFromBytes,
  PLANNING_EXPORT_FILE_NAME,
  PLANNING_SQLITE_MIME_TYPE,
} from "@/services/planningTransportCore";
export {
  importPlanningDatabase,
  PLANNER_FETCHED_SOURCES_METADATA_KEY,
  PLANNING_TRANSPORT_VERSION,
} from "@/services/planningTransportCore";
export type {
  PlannerFetchedSourcePair,
  PlanningExportSummary,
  PlanningImportSummary,
} from "@/services/planningTransportCore";

function ensureBrowser(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Planner database transfer is only available in the browser.");
  }
}

function pickFile(): Promise<File | null> {
  ensureBrowser();
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ultra-plan.db,.db,application/x-sqlite3,application/octet-stream";
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function sharePlanningDatabase() {
  ensureBrowser();
  console.info("[planning-transport] Export started");
  const exported = await createPlanningDatabaseExport();
  const buffer = new ArrayBuffer(exported.bytes.byteLength);
  new Uint8Array(buffer).set(exported.bytes);
  const blob = new Blob([buffer], { type: PLANNING_SQLITE_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = PLANNING_EXPORT_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  const { bytes: _bytes, ...summary } = exported;
  console.info("[planning-transport] Export finished", summary);
  return summary;
}

export async function pickAndImportPlanningDatabase() {
  console.info("[planning-transport] Opening planning DB picker");
  const file = await pickFile();
  if (!file) {
    console.info("[planning-transport] Planning DB picker canceled");
    return null;
  }
  console.info("[planning-transport] Import started", {
    name: file.name,
    size: file.size,
    type: file.type,
  });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const summary = await importPlanningDatabaseFromBytes(bytes);
  console.info("[planning-transport] Import finished", summary);
  return summary;
}

export async function importPlanningDatabaseFromUri(uri: string) {
  console.info("[planning-transport] Import from URI started", uri);
  const response = await fetch(uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const summary = await importPlanningDatabaseFromBytes(bytes);
  console.info("[planning-transport] Import from URI finished", summary);
  return summary;
}
