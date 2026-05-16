import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import { Share } from "react-native";
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

export async function sharePlanningDatabase() {
  const exported = await createPlanningDatabaseExport();
  const file = new File(Paths.cache, PLANNING_EXPORT_FILE_NAME);
  file.write(exported.bytes);

  await Share.share({
    url: file.uri,
    title: PLANNING_EXPORT_FILE_NAME,
  });

  const { bytes: _bytes, ...summary } = exported;
  return summary;
}

export async function pickAndImportPlanningDatabase() {
  const result = await DocumentPicker.getDocumentAsync({
    type: [PLANNING_SQLITE_MIME_TYPE, "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  return importPlanningDatabaseFromUri(result.assets[0].uri);
}

export async function importPlanningDatabaseFromUri(uri: string) {
  const bytes = await new File(uri).bytes();
  return importPlanningDatabaseFromBytes(bytes);
}
