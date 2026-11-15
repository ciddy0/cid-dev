// The page's one map <svg>: building what goes in it, and finding where that is on screen.
const NS = "http://www.w3.org/2000/svg";

export const svg = document.getElementById("map");

// Where a point of the map is on screen, in px, and `scale`, the px a schematic unit is there.
export function toScreen({ x, y }) {
  const m = svg.getScreenCTM();
  return { x: m.a * x + m.e, y: m.d * y + m.f, scale: m.a };
}

// And the other way round: the point of the map under a pointer.
export function toMap({ clientX, clientY }) {
  const m = svg.getScreenCTM();
  return { x: (clientX - m.e) / m.a, y: (clientY - m.f) / m.d, scale: m.a };
}

// A new SVG element with these attributes, appended to `parent` if there is one.
export function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}
