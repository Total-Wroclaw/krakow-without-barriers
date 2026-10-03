// Current weather in Kraków from Open-Meteo (no key; data CC BY 4.0, attribution in the UI).
// One reading for the whole city, cached for 15 minutes, so it never multiplies requests per place.
import type { Weather, WeatherCondition } from './aerial-types';

const URL_KRAKOW =
  'https://api.open-meteo.com/v1/forecast?latitude=50.0614&longitude=19.9366&current=temperature_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m&timezone=Europe/Warsaw';
const TTL = 15 * 60_000;
let cached: { at: number; weather: Weather | null } | undefined;
let inflight: Promise<Weather | null> | undefined;

/** WMO weather code → the few conditions that change advice for walking or wheeling. */
export function conditionOf(code: number, temperature: number): WeatherCondition {
  if ([56, 57, 66, 67].includes(code)) return 'ice';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return temperature <= 0 ? 'ice' : 'rain';
  if (code === 45 || code === 48) return 'fog';
  return code === 0 || code === 1 ? 'clear' : 'cloudy';
}

/** Coarse bucket for cache keys: advice only changes with the condition and a temperature band. */
export function weatherBucket(w: Weather | null) {
  if (!w) return 'none';
  const band = w.temperature <= 0 ? 'freezing' : w.temperature <= 5 ? 'cold' : w.temperature <= 24 ? 'mild' : 'hot';
  return `${w.condition}:${band}:${w.wind >= 40 ? 'windy' : 'calm'}`;
}

export function parseOpenMeteo(body: unknown, obtainedAt = new Date().toISOString()): Weather | null {
  const c = (body as { current?: Record<string, unknown> })?.current;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const temperature = num(c?.temperature_2m);
  const code = num(c?.weather_code);
  if (!c || temperature === null || code === null) return null;
  return {
    temperature: Math.round(temperature),
    precipitation: num(c.precipitation) ?? 0,
    wind: Math.round(num(c.wind_speed_10m) ?? 0),
    condition: conditionOf(code, temperature),
    time: typeof c.time === 'string' ? c.time : obtainedAt,
    obtainedAt,
  };
}

/** Current weather, or null when Open-Meteo is unavailable (the aerial view works without it). */
export async function currentWeather(): Promise<Weather | null> {
  if (cached && Date.now() - cached.at < (cached.weather ? TTL : 60_000)) return cached.weather;
  inflight ??= fetch(URL_KRAKOW, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'KazdyKrok/0.3' } })
    .then(res => (res.ok ? res.json() : null))
    .then(body => parseOpenMeteo(body))
    .catch(() => null)
    .then(weather => {
      cached = { at: Date.now(), weather };
      return weather;
    })
    .finally(() => (inflight = undefined));
  return inflight;
}
