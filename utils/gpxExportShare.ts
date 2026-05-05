import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

export function getSafeGPXFilename(name: string): string {
  const base = name.trim() || "ultra-route";
  const sanitized = base.replace(/[^a-z0-9.\-_]/gi, "_");
  return sanitized.toLowerCase().endsWith(".gpx") ? sanitized : `${sanitized}.gpx`;
}

export async function shareGPXFile(gpxContent: string, filename: string): Promise<void> {
  const safeFilename = getSafeGPXFilename(filename);
  const file = new File(Paths.cache, safeFilename);

  file.write(gpxContent);

  await Share.share({
    url: file.uri,
    title: safeFilename,
  });
}
