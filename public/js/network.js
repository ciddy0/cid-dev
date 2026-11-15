// The map data: data/metro.json, as written by scripts/build-map.mjs.
export async function loadMap() {
  const res = await fetch("data/metro.json");
  if (!res.ok) throw new Error(`metro.json: ${res.status}`);
  return res.json();
}

export const lineColor = (line) =>
  `var(--line-${line.id.toLowerCase()}, ${line.color})`;

export const lineInk = (line) =>
  `var(--ink-${line.id.toLowerCase()}, ${line.textColor})`;

export const lineParts = (line) => [line, ...(line.extraPaths ?? [])];
