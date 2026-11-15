import { COAST } from "./draw.js";
import { bendRadii, toD } from "./geometry.js";
import { onLang, t } from "./lang.js";
import { lineParts } from "./network.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

const JOBS = [
  {
    id: "csulb",
    name: "CSULB",
    role: "Instructor's Student Assistant",
    from: "2025-01",
    to: "2025-12",
    skills: ["CECS 225", "CECS 174", "CECS 105"], // the courses I assisted
    map: "eastLongBeach",
    pin: [47, 21.5],
  },
  {
    id: "unite",
    name: "UNITE-LA",
    role: "Cleantech Intern",
    from: "2025-09",
    to: "2025-12",
    skills: ["Clean Energy", "Research"],
    map: "metro",
    pin: [-1, -0.9], // Wilshire, just west of the 110: in the main map's own units
  },
  {
    id: "latech",
    name: "LA-Tech.org",
    role: "Software Engineer Intern",
    from: "2026-02",
    to: "2026-05",
    skills: ["Node.js", "MongoDB", "React Native"],
    map: "metro",
    pin: [1.1, -0.6],
  },
  {
    id: "csu",
    name: "CSU",
    role: "Junior Data Engineer",
    from: "2026-08",
    skills: ["PySpark", "SQL"],
    map: "longBeach",
    pin: [31.8, 62], // the Chancellor's Office, on Golden Shore
  },
];

const MAPS = {
  longBeach: {
    water: [
      "M26 0h2.5v62l2.5 5 7 2h6l2-3 14 1.5 40 2 20-3.5v14H34l-1-8-4-4-3-2z" + // the river and the bay
        "M66 73h3v3h-3zM88 74h3v3h-3zM106 73h3v3h-3z", // the oil islands
      "M0 57h20l6 3v3h-8l-6-2H0zM0 67h8l4 5v8H0z", // the port's channels
    ],
    rivers: [],
    lines: [
      [
        "a",
        [
          [40, 0],
          [42, 3],
          [42, 57],
          [36, 57],
          [36, 49.8],
          [42, 49.8],
        ],
      ],
    ],
    // Willow St, Pacific Coast Hwy, Anaheim St, 5th St, 1st St, Downtown Long Beach, Pacific Av.
    stops: [
      [42, 10.2],
      [42, 24],
      [42, 38.6],
      [42, 49.8],
      [42, 57],
      [36, 57],
      [36, 52.5],
    ],
  },
  eastLongBeach: {
    water: [
      "M0 41l20.8 5.2 13.9 7L45 59l12.8 8 11.6 7 5.6 6H0zM10 61h3v2.5h-3zM24 66h3v2.5h-3z", // the sea
      "M46 61l3-3-1-7-2-7-5-6-5-2-2 2 5 4 2 3-6-1-3 3.5 3 4.5 6 3zM36 46.5h5l1.5 3-3 2-3.5-2z", // the bay
      "M62 70l4-6 4-2 2-6 4-1 1 5 4 2-1 6-5-1-3 4-5 1-2 2z", // the wetlands
      "M76 80l4-5 8-1 3 3-2 3z",
    ],
    rivers: [
      [
        [70, 0],
        [64, 16],
        [60, 28],
        [59, 42],
        [55, 56],
        [52, 64],
      ],
    ],
    lines: [
      [
        "bus",
        [
          [0, 18],
          [55, 18],
          [55, 0],
        ],
      ], // the 170s: Atherton St, then up Studebaker Rd
      [
        "bus",
        [
          [0, 31.5],
          [40.5, 31.5],
          [40.5, 0],
        ],
      ], // the 90s: 7th St, then up Bellflower Blvd
      [
        "bus",
        [
          [0, 25],
          [29, 25],
          [35.5, 31.5],
          [48, 31.5],
          [48, 27],
        ],
      ], // the 40s: Anaheim St to campus
      [
        "bus",
        [
          [0, 38],
          [20, 38],
          [30.5, 48.5],
          [52.5, 48.5],
        ],
      ], // the 121: 2nd St, over Naples
      [
        "bus",
        [
          [35.5, 31.5],
          [72, 68],
          [74, 80],
        ],
      ], // the 171: down Pacific Coast Hwy to Seal Beach
    ],
    stops: [
      [48, 27],
      [40.5, 18],
      [40.5, 31.5],
      [35.5, 31.5],
      [39, 48.5],
      [52.5, 48.5],
    ],
  },
};
// The main map itself, shrunk to fit a picture: built from data/metro.json once it is loaded
// (see showMetro), and empty until then. Its pins are in the map's own units, so `at` takes
// them into the picture's.
const PIC_W = 120,
  PIC_H = 80,
  PIC_PAD = 0.7; // schematic units of clear space round the network

function metroPicture(map) {
  const { lane, bounds: b } = map.layout;
  const w = b.maxX - b.minX + 2 * PIC_PAD,
    h = b.maxY - b.minY + 2 * PIC_PAD;
  const k = Math.min(PIC_W / w, PIC_H / h);
  const ox = (PIC_W - w * k) / 2 - (b.minX - PIC_PAD) * k,
    oy = (PIC_H - h * k) / 2 - (b.minY - PIC_PAD) * k;
  const at = ([x, y]) => [+(ox + x * k).toFixed(2), +(oy + y * k).toFixed(2)];
  const tracks = map.lines.flatMap((line) =>
    lineParts(line).map((part) => ({ line: line.id.toLowerCase(), pts: part.path.map(at) })),
  );
  const radii = bendRadii(tracks, 0.5 * k, lane * k);
  return {
    at,
    width: lane * k * 1.6, // thicker than the main map's, so they still read this small
    water: [toD(COAST.map(at)) + "Z"],
    rivers: [],
    paths: tracks.map(({ line, pts }, i) => [line, toD(pts, radii[i])]),
    lines: [],
    stops: Object.values(map.stations)
      .filter((s) => s.transfer)
      .map((s) => at([s.x, s.y])),
    r: lane * k * 1.8,
  };
}
let redraw = () => {};
export function showMetro(map) {
  MAPS.metro = metroPicture(map);
  redraw();
}

// The lines whose colours a job's skills are dotted in, in turn.
const DOTS = ["a", "b", "c", "d", "e", "g", "k"];

// A job's picture: its map, and a diamond where the job was.
function picture(job) {
  const pic = MAPS[job.map];
  if (!pic) return `<svg class="pic" viewBox="0 0 ${PIC_W} ${PIC_H}" aria-hidden="true"></svg>`;
  const { water, rivers, lines, paths = [], stops, at = (p) => p, width, r = 1.3 } = pic,
    [x, y] = at(job.pin),
    run = (points) => `points="${points.join(" ")}"`;
  return `<svg class="pic" viewBox="0 0 ${PIC_W} ${PIC_H}" aria-hidden="true"${width ? ` style="--w: ${width.toFixed(2)}"` : ""}>
    ${water.map((d) => `<path class="water" fill-rule="evenodd" d="${d}"/>`).join("")}
    ${rivers.map((river) => `<polyline class="river" ${run(river)}/>`).join("")}
    ${lines.map(([line, points]) => `<polyline style="--c: var(--line-${line})" ${run(points)}/>`).join("")}
    ${paths.map(([line, d]) => `<path class="line" style="--c: var(--line-${line})" d="${d}"/>`).join("")}
    ${stops.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="${+r.toFixed(2)}"/>`).join("")}
    <rect class="pin" x="${x - 1.9}" y="${y - 1.9}" width="3.8" height="3.8" transform="rotate(45 ${x} ${y})"/>
  </svg>`;
}

const SWIPE = 48; // px a swipe travels to move on a job
const STRETCH = 0.35; // how far the strip follows a swipe past either end
const CHIME_LATER = [72, 76]; // MIDI notes: C5 up to E5
const CHIME_EARLIER = [72, 67];

export function resume() {
  const jobs = document.querySelector("#resume .jobs"),
    strip = jobs.querySelector(".strip");
  let at = JOBS.length - 1;

  const month = (ym) =>
    new Intl.DateTimeFormat(prefs.lang === "es" ? "es-MX" : "en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${ym}-15`));

  function build() {
    strip.innerHTML = JOBS.map((job, i) => {
      const { kind, blurb, stat } = t("jobs")[job.id];
      const when = `${month(job.from)} – ${job.to ? month(job.to) : t("present")}`;
      const skills = job.skills.map(
        (s, k) =>
          `<span class="skill" style="--c: var(--line-${DOTS[k % DOTS.length]})">${t("skills")?.[s] ?? s}</span>`,
      );
      return `<article class="job" data-i="${i}">
        <h2><button>${job.name}</button></h2>
        <div class="skills">${skills.join("")}</div>
        ${picture(job)}
        <div class="full">
          <p class="role">${job.role}</p>
          <p>${when} · ${kind}</p>
          <p class="blurb">${blurb}</p>
          <p class="stat"><b>${stat[0]}</b><span>${stat[1]}</span></p>
        </div>
      </article>`;
    }).join("");
    show();
  }

  // Only the picked job's name is in the tab order: the arrow keys walk the rest. A swipe
  // shuts the card (`open` false) for as long as it has hold of the strip.
  const named = () => strip.children[at].querySelector("button");
  function show(open = true) {
    strip.style.setProperty("--at", at);
    strip.querySelectorAll(".job").forEach((node, i) => {
      node.classList.toggle("on", open && i === at);
      const name = node.querySelector("button");
      name.tabIndex = i === at ? 0 : -1;
      if (i === at) name.setAttribute("aria-current", "true");
      else name.removeAttribute("aria-current");
    });
  }

  // Focus on a job's name moves on to the new job's.
  function pick(i) {
    if (i === at || !(i in JOBS)) return;
    const had = document.activeElement;
    chime(...(i > at ? CHIME_LATER : CHIME_EARLIER));
    at = i;
    show();
    if (had?.closest(".job")) named().focus({ preventScroll: true });
  }

  // A swipe drags the strip along with it under an empty card, then lets go onto the next job
  // if it went far enough. Up and down are left to the browser, which scrolls a card too tall
  // for the screen.
  let swipe = null,
    swiped = false; // so the click that ends a swipe isn't a tap on whatever it ended over
  jobs.addEventListener("pointerdown", (e) => {
    if (!e.button)
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false };
  });
  jobs.addEventListener("pointermove", (e) => {
    if (swipe?.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    if (!swipe.on) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - swipe.y))
        return;
      swipe.on = true;
      jobs.setPointerCapture(e.pointerId);
      strip.classList.add("dragging");
      show(false);
    }
    swipe.dx = dx;
    const past = !(at - Math.sign(dx) in JOBS);
    strip.style.setProperty("--drag", `${past ? dx * STRETCH : dx}px`);
  });
  const lift = (e) => {
    if (swipe?.id !== e.pointerId) return;
    const { on, dx } = swipe;
    swipe = null;
    if (!on) return;
    swiped = true;
    setTimeout(() => (swiped = false)); // the click, if one comes, comes before this
    strip.classList.remove("dragging");
    strip.style.setProperty("--drag", "0px");
    show(); // the card opens again, on the next job if the swipe went far enough
    if (Math.abs(dx) > SWIPE) pick(at - Math.sign(dx));
  };
  jobs.addEventListener("pointerup", lift);
  jobs.addEventListener("pointercancel", lift);

  jobs.addEventListener("click", (e) => {
    if (swiped) return;
    const job = e.target.closest(".job");
    if (job) pick(+job.dataset.i);
  });
  addEventListener("keydown", (e) => {
    if (jobs.closest(".screen").hidden || e.altKey || e.ctrlKey || e.metaKey)
      return;
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by) return;
    e.preventDefault();
    pick(at + by);
  });

  redraw = build;
  onLang(build);
}
