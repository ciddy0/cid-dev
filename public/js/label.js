// The station label: one floating chip row + name, shared by hover, tap and keyboard focus,
// with a halo round the station it names.
import { svg } from "./dom.js";
import { clamp } from "./math.js";
import { lineColor, lineInk } from "./network.js";

const HOVER_REACH = 12; // px from a station that the mouse still picks it
const TAP_REACH = 24; // and a finger
const EDGE = 8; // px the label keeps from the window's edge, and from its station's halo

const label = document.getElementById("label");

export function stationLabel({ stations, halo, lane }, cam) {
  let active = null;

  const toScreen = (s) => {
    const m = svg.getScreenCTM();
    return { x: m.a * s.x + m.e, y: m.d * s.y + m.f, scale: m.a };
  };

  function place() {
    if (!active) return;
    const p = toScreen(active);
    const gap = active.halo * p.scale + EDGE;
    const w = label.offsetWidth,
      h = label.offsetHeight;
    const x = clamp(p.x - w / 2, EDGE, innerWidth - w - EDGE);
    let y = p.y - gap - h;
    if (y < EDGE) y = p.y + gap; // no room above: drop below the station
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function show(s) {
    if (s === active) return;
    active = s;
    const chips = document.createElement("span");
    chips.className = "chips";
    for (const line of s.lines) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = line.id;
      chip.style.background = lineColor(line);
      chip.style.color = lineInk(line);
      chips.append(chip);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    label.replaceChildren(chips, name);
    halo.setAttribute("cx", s.x);
    halo.setAttribute("cy", s.y);
    halo.setAttribute("r", s.halo);
    place();
    label.classList.add("on");
    halo.classList.add("on");
    svg.classList.add("hot");
  }

  function hide() {
    active = null;
    label.classList.remove("on");
    halo.classList.remove("on");
    svg.classList.remove("hot");
  }

  // Stations are tiny, so pick the nearest one within a finger-sized radius instead of
  // relying on the marker itself being hit.
  function nearest(e, reachPx) {
    const m = svg.getScreenCTM();
    const x = (e.clientX - m.e) / m.a,
      y = (e.clientY - m.f) / m.d;
    const reach = Math.max(reachPx / m.a, 0.45);
    let best = null,
      bestD = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.y - y) - (s.halo - lane);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return bestD <= reach ? best : null;
  }
  const pick = (e, reachPx) => {
    const s = nearest(e, reachPx);
    if (s) show(s);
    else hide();
  };

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && !cam.dragging && cam.roam) pick(e, HOVER_REACH);
  });
  cam.onTap = (e) => {
    if (e.pointerType !== "mouse") pick(e, TAP_REACH);
  };
  // The label rides along with its station, and goes when the station leaves the screen or the
  // camera heads back to the menu.
  cam.onMove = () => {
    if (active && !(cam.roam && cam.sees(active))) hide();
    else place();
  };
  // Mouse only: a finger lifting off also "leaves", right after the tap that showed the label.
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hide();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  for (const s of stations) {
    s.g.addEventListener("focus", () => {
      cam.reveal(s);
      show(s);
    });
    s.g.addEventListener("blur", () => {
      if (active === s) hide();
    });
  }
}
