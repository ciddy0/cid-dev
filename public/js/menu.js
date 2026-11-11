// The menu: the home screen is the map closed in near the hub, with the menu in a gap between
// the lines. Each item's arrow is the way the camera travels to reach that item's screen, and
// the back arrow there points the way home. Only "view" shows the stations and hands the map
// over to the visitor.
import { svg } from "./dom.js";
import { drawIn } from "./intro.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

// Screen id → how many windows across and down from the menu it lies. Each has a button in
// #menu with data-go="<id>" and, all but view (where the map is the screen), a panel with that id.
const SCREENS = { view: [1, 0], resume: [1, -1], docs: [1, 1], settings: [0, 1] };

// How thick a line is drawn, in px: behind the menu, where lines are fat backdrop, and where the
// view screen opens. Stations sit too far apart for the whole map to be on screen at that last
// one, so the view opens on the hub and is panned, or zoomed out as far as the whole map.
const LINE_MENU = 13.5;
const LINE_VIEW = 8;

const GLIDE_MS = 900; // the camera's trip between the menu and a screen
const SWELL_MS = 220; // the picked item swells for this long before the camera leaves
const INTRO_MS = 1400; // the opening move from the whole map in to the menu

const CHIME_GO = [65, 72]; // MIDI notes: F4 up to C5
const CHIME_HOME = [72, 65];

// `onViewing(on)` is called as the view screen is entered and left.
export function menu({ tracks, box, hub, lane }, cam, { onViewing = () => {} } = {}) {
  const nav = document.getElementById("menu"),
    back = document.getElementById("back"),
    main = svg.parentElement;
  const panel = (id) => document.getElementById(id);
  const item = (id) => nav.querySelector(`[data-go="${id}"]`);
  const ms = () => (prefs.motion ? GLIDE_MS : 0);
  let screen = null, // null on the menu itself
    busy = true;

  // Where the menu sits: the spot nearest the hub with room for its buttons and a margin, clear
  // of every line. Failing that, the roomiest spot there is. Worked out once per screen size.
  const dots = tracks.flatMap(({ pts }) =>
    pts.slice(1).flatMap(([x, y], i) => {
      const [px, py] = pts[i],
        n = Math.ceil(Math.hypot(x - px, y - py) / 0.2);
      return Array.from({ length: n + 1 }, (_, j) => [
        px + ((x - px) * j) / n,
        py + ((y - py) * j) / n,
      ]);
    }),
  );
  let seated = {};
  function seat() {
    const key = `${innerWidth}x${innerHeight}`;
    if (seated.key === key || nav.hidden) return seated.at; // hidden, it can't be measured
    const r = [...nav.children].map((b) => b.getBoundingClientRect()),
      k = menuZoom(),
      margin = 0.7;
    const w = (Math.max(...r.map((b) => b.right)) - Math.min(...r.map((b) => b.left))) / k / 2,
      h = (r.at(-1).bottom - r[0].top) / k / 2;
    let best,
      bestScore = -Infinity;
    for (let x = box.x; x <= box.x + box.w; x += 0.5)
      for (let y = box.y; y <= box.y + box.h; y += 0.5) {
        let room = margin;
        for (const [dx, dy] of dots) {
          room = Math.min(room, Math.max(Math.abs(dx - x) - w, Math.abs(dy - y) - h));
          if (room < margin && bestScore > -1e3) break; // cramped, and a clear spot is known
        }
        // Clear spots (room === margin) rank by closeness to the hub, above all cramped ones.
        const score = room < margin ? room - 2e3 : -Math.hypot(x - hub.x, y - hub.y);
        if (score > bestScore) [best, bestScore] = [{ x, y }, score];
      }
    seated = { key, at: best };
    return best;
  }

  // The views the camera is sent to. On the menu and its panels: close in on the menu's seat,
  // or (dx, dy) windows away from it.
  const menuZoom = () => Math.max(LINE_MENU / lane, cam.fit * 1.5);
  const beside = (dx = 0, dy = 0) => {
    const k = menuZoom(),
      { x, y } = seat();
    return { x: x + (dx * innerWidth) / k, y: y + (dy * innerHeight) / k, k };
  };
  // On the view screen: on the hub, or on the whole map if that is closer still.
  const open = () => {
    const k = LINE_VIEW / lane;
    return cam.fit < k ? cam.hold({ x: hub.x, y: hub.y, k }) : cam.whole();
  };
  const spot = (id) => (id === "view" ? open() : beside(...(SCREENS[id] ?? [])));
  cam.rest = () => spot(screen);

  // p = 0 on the menu, 1 on the screen. Between the two, both slide by with the map under them.
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
    back.style.setProperty("--turn", `${(Math.atan2(dy, dx) * 180) / Math.PI + 180}deg`);
    back.hidden = false;
    if (panel(id)) panel(id).hidden = false;
    place(id, 0);
    nav.classList.add("choosing");
    item(id).classList.add("picked");
    chime(...CHIME_GO);
    const leave = () => {
      viewing(id === "view");
      cam.glide(spot(id), ms(), (e) => place(id, e), () => {
        screen = id;
        busy = false;
        nav.hidden = true;
        nav.classList.remove("choosing");
        item(id).classList.remove("picked");
        cam.roam = id === "view";
        main.inert = !cam.roam;
        back.focus({ preventScroll: true });
      });
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
    cam.glide(spot(), ms(), (e) => place(id, 1 - e), () => {
      busy = false;
      back.hidden = true;
      if (panel(id)) panel(id).hidden = true;
      item(id).focus({ preventScroll: true });
    });
  }

  nav.addEventListener("click", (e) => {
    const id = e.target.closest("[data-go]")?.dataset.go;
    if (id) go(id);
  });
  back.addEventListener("click", home);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") home();
  });

  // Open on the whole map as its lines draw in, then close in on the hub as the menu fades up.
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
