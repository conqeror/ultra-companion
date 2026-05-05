import { OPEN_METEO_API_URL } from "@/constants";

/**
 * Raw hourly forecast data from Open-Meteo for a single location.
 */
export interface HourlyForecast {
  latitude: number;
  longitude: number;
  hours: {
    time: string; // ISO 8601
    temperature2m: number;
    apparentTemperature2m: number;
    dewPoint2m: number;
    relativeHumidity2m: number;
    precipitation: number;
    precipitationProbability: number;
    weatherCode: number;
    windSpeed10m: number;
    windDirection10m: number;
    windGusts10m: number;
    isDay: number;
  }[];
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    apparent_temperature: number[];
    dew_point_2m: number[];
    relative_humidity_2m: number[];
    precipitation: number[];
    precipitation_probability: number[];
    weather_code: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    wind_gusts_10m: number[];
    is_day: number[];
  };
}

/**
 * Fetch hourly weather forecasts for multiple coordinates.
 * Uses individual API calls (batched 5 at a time) since multi-point requires the commercial API.
 */
export async function fetchForecasts(
  coordinates: { latitude: number; longitude: number }[],
  forecastHours: number = 24,
): Promise<HourlyForecast[]> {
  if (coordinates.length === 0) return [];

  // Deduplicate nearby coordinates (within ~1km) to reduce API calls
  const deduped = deduplicateCoords(coordinates, 0.01);

  const results: HourlyForecast[] = [];

  // Fetch in parallel, max 5 concurrent to be a good API citizen
  const batches = chunk(deduped, 5);
  for (const batch of batches) {
    const promises = batch.map((coord) => fetchSingleForecast(coord, forecastHours));
    const batchResults = await Promise.allSettled(promises);
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }

  return results;
}

async function fetchSingleForecast(
  coord: { latitude: number; longitude: number },
  forecastHours: number,
): Promise<HourlyForecast> {
  const params = new URLSearchParams({
    latitude: coord.latitude.toFixed(4),
    longitude: coord.longitude.toFixed(4),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "dew_point_2m",
      "relative_humidity_2m",
      "precipitation",
      "precipitation_probability",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "is_day",
    ].join(","),
    forecast_hours: String(forecastHours),
    timezone: "auto",
  });

  const response = await fetch(`${OPEN_METEO_API_URL}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status}`);
  }

  const data: OpenMeteoResponse = await response.json();

  const hours = data.hourly.time.map((time, i) => ({
    time,
    temperature2m: data.hourly.temperature_2m[i],
    apparentTemperature2m: data.hourly.apparent_temperature[i],
    dewPoint2m: data.hourly.dew_point_2m[i],
    relativeHumidity2m: data.hourly.relative_humidity_2m[i],
    precipitation: data.hourly.precipitation[i],
    precipitationProbability: data.hourly.precipitation_probability[i],
    weatherCode: data.hourly.weather_code[i],
    windSpeed10m: data.hourly.wind_speed_10m[i],
    windDirection10m: data.hourly.wind_direction_10m[i],
    windGusts10m: data.hourly.wind_gusts_10m[i],
    isDay: data.hourly.is_day[i],
  }));

  return {
    latitude: data.latitude,
    longitude: data.longitude,
    hours,
  };
}

function deduplicateCoords(
  coords: { latitude: number; longitude: number }[],
  threshold: number,
): { latitude: number; longitude: number }[] {
  const result: { latitude: number; longitude: number }[] = [];
  for (const coord of coords) {
    const isDuplicate = result.some(
      (r) =>
        Math.abs(r.latitude - coord.latitude) < threshold &&
        Math.abs(r.longitude - coord.longitude) < threshold,
    );
    if (!isDuplicate) result.push(coord);
  }
  return result;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
