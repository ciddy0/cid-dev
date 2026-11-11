// The page's one map <svg>, and a helper for building what goes in it.
const NS = "http://www.w3.org/2000/svg";

export const svg = document.getElementById("map");

// A new SVG element with these attributes, appended to `parent` if there is one.
export function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}
