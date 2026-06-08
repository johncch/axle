const PREVIEW_MAX = 500;
const MIDDLE_MAX = 600;

export function truncate(value: string, max: number = PREVIEW_MAX): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value;
}

export function truncateMiddle(value: string, max: number = MIDDLE_MAX): string {
  if (value.length <= max) return value;
  const half = Math.floor(max / 2);
  return `${value.slice(0, half)}…[${value.length} chars]…${value.slice(-half)}`;
}
