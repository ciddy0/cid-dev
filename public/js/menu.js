import { svg } from "./dom.js";
import { drawIn } from "./intro.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

const SCREENS = {
  view: [1, 0],
  resume: [1, -1],
  docs: [1, 1],
  settings: [0, 1],
};

const LINE_MENU = 13.5;
const LINE_VIEW = 8;
const MENU_ZOOM = 1.5;

const SEAT_MARGIN = 0.7;
const SEAT_STEP = 0.5;
const DOT_STEP = 0.2;
const CRAMPED = 2e3;

const GLIDE_MS = 900;
const SWELL_MS = 220;
const INTRO_MS = 1400;

const CHIME_GO = [65, 72];
const CHIME_HOME = [72, 65];

export function menu(
  { tracks, box, hub, lane },
  cam,
  { onViewing = () => {} } = {},
) {
  const nav = document.getElementById("menu"),
    back = document.getElementById("back"),
    main = svg.parentElement;
  const panel = (id) => document.getElementById(id);
  const item = (id) => nav.querySelector(`[data-go="${id}"]`);
  const ms = () => (prefs.motion ? GLIDE_MS : 0);
  let screen = null,
    busy = true;
  nav.classList.remove("waiting");

  const dots = tracks.flatMap(({ pts }) =>
    pts.slice(1).flatMap(([x, y], i) => {
      const [px, py] = pts[i],
        n = Math.ceil(Math.hypot(x - px, y - py) / DOT_STEP);
      return Array.from({ length: n + 1 }, (_, j) => [
        px + ((x - px) * j) / n,
        py + ((y - py) * j) / n,
      ]);
    }),
  );
  let seated = {};
  function seat() {
    const key = `${innerWidth}x${innerHeight} ${prefs.lang}`;
    if (seated.key === key || nav.hidden) return seated.at;
    const r = [...nav.children].map((b) => b.getBoundingClientRect()),
      k = menuZoom();
    const w =
        (Math.max(...r.map((b) => b.right)) -
          Math.min(...r.map((b) => b.left))) /
        k /
        2,
      h = (r.at(-1).bottom - r[0].top) / k / 2;
    let best,
      bestScore = -Infinity;
    for (let x = box.x; x <= box.x + box.w; x += SEAT_STEP)
      for (let y = box.y; y <= box.y + box.h; y += SEAT_STEP) {
        let room = SEAT_MARGIN;
        for (const [dx, dy] of dots) {
          room = Math.min(
            room,
            Math.max(Math.abs(dx - x) - w, Math.abs(dy - y) - h),
          );
          if (room < SEAT_MARGIN && bestScore > -CRAMPED / 2) break; // cramped, and a clear spot is known
        }
        const score =
          room < SEAT_MARGIN
            ? room - CRAMPED
            : -Math.hypot(x - hub.x, y - hub.y);
        if (score > bestScore) [best, bestScore] = [{ x, y }, score];
      }
    seated = { key, at: best };
    return best;
  }

  const menuZoom = () => Math.max(LINE_MENU / lane, cam.fit * MENU_ZOOM);
  const beside = (dx = 0, dy = 0) => {
    const k = menuZoom(),
      { x, y } = seat();
    return { x: x + (dx * innerWidth) / k, y: y + (dy * innerHeight) / k, k };
  };
  const open = () => {
    const k = LINE_VIEW / lane;
    return cam.fit < k ? cam.hold({ x: hub.x, y: hub.y, k }) : cam.whole();
  };
  const spot = (id) =>
    id === "view" ? open() : beside(...(SCREENS[id] ?? []));
  cam.rest = () => spot(screen);

  function place(id, p) {
    const [dx, dy] = SCREENS[id];
    const shift = (node, q) =>
      (node.style.transform = `translate(${dx * q * innerWidth}px, ${dy * q * innerHeight}px)`);
    shift(nav, -p);
    if (panel(id)) shift(panel(id), 1 - p);
    back.style.opacity = p;
  }

  function viewing(on) {
    svg.classList.toggle("viewing", on);
    onViewing(on);
  }

  function go(id) {
    if (busy) return;
    busy = true;
    const [dx, dy] = SCREENS[id];
    back.style.setProperty(
      "--turn",
      `${(Math.atan2(dy, dx) * 180) / Math.PI + 180}deg`,
    );
    back.hidden = false;
    if (panel(id)) panel(id).hidden = false;
    place(id, 0);
    nav.classList.add("choosing");
    item(id).classList.add("picked");
    chime(...CHIME_GO);
    const leave = () => {
      viewing(id === "view");
      cam.glide(
        spot(id),
        ms(),
        (e) => place(id, e),
        () => {
          screen = id;
          busy = false;
          nav.hidden = true;
          nav.classList.remove("choosing");
          item(id).classList.remove("picked");
          cam.roam = id === "view";
          main.inert = !cam.roam;
          back.focus({ preventScroll: true });
        },
      );
    };
    setTimeout(leave, prefs.motion ? SWELL_MS : 0);
  }

  function home() {
    if (busy || !screen) return;
    busy = true;
    const id = screen;
    screen = null;
    cam.roam = false;
    main.inert = true;
    nav.hidden = false;
    viewing(false);
    chime(...CHIME_HOME);
    cam.glide(
      spot(),
      ms(),
      (e) => place(id, 1 - e),
      () => {
        busy = false;
        back.hidden = true;
        if (panel(id)) panel(id).hidden = true;
        item(id).focus({ preventScroll: true });
      },
    );
  }

  nav.addEventListener("click", (e) => {
    const id = e.target.closest("[data-go]")?.dataset.go;
    if (id) go(id);
  });
  back.addEventListener("click", home);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") home();
  });

  main.inert = true;
  const ready = () => {
    busy = false;
    nav.style.opacity = "";
  };
  if (!prefs.motion) {
    cam.set(spot());
    return ready();
  }
  cam.set(cam.whole());
  nav.style.opacity = 0;
  setTimeout(
    () => cam.glide(spot(), INTRO_MS, (e) => (nav.style.opacity = e), ready),
    drawIn(tracks),
  );
}
