export function pickRouteRecords<T>(
  records: Record<string, T[]>,
  routeIds: readonly string[],
): Record<string, T[]> {
  if (routeIds.length === 0) return {};

  const picked: Record<string, T[]> = {};
  for (const routeId of routeIds) {
    const values = records[routeId];
    if (values) picked[routeId] = values;
  }
  return picked;
}
