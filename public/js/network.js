// The map data: data/metro.json, as written by scripts/build-map.mjs.
export async function loadMap() {
  const res = await fetch("data/metro.json");
  if (!res.ok) throw new Error(`metro.json: ${res.status}`);
  return res.json();
}

// A line's colour: the page's own palette (--line-a …) where it has one, else the agency's.
export const lineColor = (line) =>
  `var(--line-${line.id.toLowerCase()}, ${line.color})`;

// Everything a line is drawn as: its main path, then any extra paths (stations only served in
// one direction). Each has `stations`, `path`, `stops` and `at`.
export const lineParts = (line) => [line, ...(line.extraPaths ?? [])];
