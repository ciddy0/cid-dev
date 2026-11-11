// The camera: the map's viewBox. While `roam` is on it is driven by drag, pinch and wheel and
// kept on the map; otherwise it goes wherever it is set or glided to, off the map's edge
// included. A view is { x, y, k }: its centre in schematic units, and k px per unit.
import { svg } from "./dom.js";
import { clamp, easeInOutCubic, round } from "./math.js";
import { prefs } from "./prefs.js";

const LINE_MAX = 19; // how thick a line is drawn, in px, as close as the view zooms in
const TAP_SLOP = 6; // px a pointer can wander and still be a tap rather than a drag

// `box` is what the camera keeps on screen, and `lane` how thick the lines are drawn. Returns:
//   roam, dragging      whether the visitor has the controls, and is dragging right now
//   onMove(), onTap(e)  hooks, there to be replaced: the view changed; the map was tapped
//   rest()              hook: the view to return to on resize, until someone drags it
//   fit                 the k at which the whole map just fits
//   whole(), hold(view) the view of the whole map; `view` moved back onto the map
//   set(view), glide(view, ms, onStep, onDone)
//   sees(point), reveal(point)
export function camera({ box, lane }) {
  const MAX_ZOOM = LINE_MAX / lane;
  const view = { x: 0, y: 0, k: 1 };
  let rect, fit, anim, settle, touched = false;
  const cam = {
    dragging: false,
    roam: false,
    onMove() {},
    onTap() {},
    get fit() {
      return fit;
    },
  };

  // A view kept on the map: an axis the map fits along stays centred; the other stops at the
  // map's edge.
  cam.hold = ({ x, y, k }) => {
    const axis = (c, lo, size, span) =>
      span >= size ? lo + size / 2 : clamp(c, lo + span / 2, lo + size - span / 2);
    return {
      x: axis(x, box.x, box.w, rect.width / k),
      y: axis(y, box.y, box.h, rect.height / k),
      k,
    };
  };
  cam.whole = () => ({ x: box.x + box.w / 2, y: box.y + box.h / 2, k: fit });
  cam.rest = cam.whole;

  const zoomRange = (k) => clamp(k, fit, Math.max(MAX_ZOOM, fit));

  function apply() {
    if (cam.roam) view.k = zoomRange(view.k);
    const w = rect.width / view.k,
      h = rect.height / view.k;
    if (cam.roam) Object.assign(view, cam.hold(view));
    svg.setAttribute("viewBox", [view.x - w / 2, view.y - h / 2, w, h].map(round).join(" "));
    svg.classList.toggle("loose", view.k > fit * 1.001);
    cam.onMove();
  }

  cam.set = (to) => {
    Object.assign(view, to);
    apply();
  };

  const stop = () => cancelAnimationFrame(anim);
  // Ease the view over to `to`, reporting progress 0 → 1 to `onStep` along the way.
  cam.glide = (to, ms, onStep = () => {}, onDone = () => {}) => {
    stop();
    touched = false;
    const from = { ...view },
      t0 = performance.now();
    const step = (now) => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1,
        e = easeInOutCubic(t);
      view.k = from.k * (to.k / from.k) ** e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      apply();
      onStep(e);
      if (t < 1) return (anim = requestAnimationFrame(step));
      settle = null;
      onDone();
    };
    settle = () => {
      stop();
      step(Infinity);
    };
    anim = requestAnimationFrame(step);
  };

  function measure() {
    rect = svg.getBoundingClientRect();
    fit = Math.min(rect.width / box.w, rect.height / box.h);
  }
  function resize() {
    measure();
    settle?.(); // a glide under way was aimed at the old size: finish it, then re-place
    if (!touched) {
      stop();
      Object.assign(view, cam.rest());
    }
    apply();
  }

  const pan = (dx, dy) => {
    view.x -= dx / view.k;
    view.y -= dy / view.k;
  };
  // Zoom by `factor`, keeping whatever is under the screen point (px, py) where it is.
  function zoom(px, py, factor) {
    const ox = px - rect.left - rect.width / 2,
      oy = py - rect.top - rect.height / 2;
    const k = zoomRange(view.k * factor);
    view.x += ox / view.k - ox / k;
    view.y += oy / view.k - oy / k;
    view.k = k;
  }

  const fingers = new Map(); // pointer id → last clientX / clientY
  let travel = 0, // px moved since the first finger went down; a tap stays under TAP_SLOP
    last = 0,
    vx = 0,
    vy = 0; // px per ms, smoothed, for the fling after a drag
  const centre = () => {
    const pts = [...fingers.values()];
    return {
      x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
      y: pts.reduce((sum, p) => sum + p.y, 0) / pts.length,
      spread: pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
    };
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stop();
    touched = true;
    if (!fingers.size) travel = vx = vy = 0;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!fingers.has(e.pointerId)) return;
    const was = centre();
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = centre();
    const dx = now.x - was.x,
      dy = now.y - was.y;
    travel += Math.hypot(dx, dy) + Math.abs(now.spread - was.spread);
    if (travel < TAP_SLOP) return;
    cam.dragging = true;
    svg.classList.add("dragging");
    const dt = Math.max(1, e.timeStamp - last);
    last = e.timeStamp;
    vx = vx * 0.6 + (dx / dt) * 0.4;
    vy = vy * 0.6 + (dy / dt) * 0.4;
    pan(dx, dy);
    if (was.spread && now.spread) zoom(now.x, now.y, now.spread / was.spread);
    apply();
  });
  const lift = (e) => {
    if (!fingers.delete(e.pointerId) || fingers.size) return;
    const tap = !cam.dragging && e.type === "pointerup";
    cam.dragging = false;
    svg.classList.remove("dragging");
    if (tap) return cam.onTap(e);
    if (!prefs.motion || e.timeStamp - last > 80 || Math.hypot(vx, vy) < 0.1) return;
    // Fling: carry on at the speed the finger left with, slowing to a stop.
    let then = performance.now();
    const coast = (now) => {
      const dt = Math.min(now - then, 50);
      then = now;
      pan(vx * dt, vy * dt);
      vx *= 0.995 ** dt;
      vy *= 0.995 ** dt;
      apply();
      if (Math.hypot(vx, vy) > 0.02) anim = requestAnimationFrame(coast);
    };
    anim = requestAnimationFrame(coast);
  };
  svg.addEventListener("pointerup", lift);
  svg.addEventListener("pointercancel", lift);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stop();
      touched = true;
      // A trackpad pinch arrives as a ctrl+wheel with small deltas.
      zoom(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      apply();
    },
    { passive: false },
  );
  addEventListener("resize", resize);

  cam.sees = (s) =>
    Math.abs(s.x - view.x) * view.k <= rect.width / 2 &&
    Math.abs(s.y - view.y) * view.k <= rect.height / 2;
  // Bring a point into view, for keyboard focus landing on a station that is off screen.
  cam.reveal = (s) => {
    if (cam.sees(s)) return;
    stop();
    touched = true;
    view.x = s.x;
    view.y = s.y;
    apply();
  };

  measure();
  return cam;
}
