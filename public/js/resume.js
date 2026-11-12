// The resume screen: my jobs along a line across the screen, oldest on the left. A card sits
// still on the middle of the line with the picked job's words on it, and the others wait faded
// either side, a name and a picture each. To bring another in, the words leave the card, the
// strip of jobs slides over it, and the new job's words come up as it stops: tap a job, use
// the arrow keys, or swipe.
import { onLang, t } from "./lang.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

// What stays the same in every language. The rest of a job's words are under `jobs` in
// lang.js, by id. A job with no `to` is the one I'm still at. `map` is its picture: a little
// map of lines, each a run of points on a 96 by 48 grid.
const JOBS = [
  {
    id: "unite",
    name: "UNITE-LA",
    role: "Cleantech Intern",
    from: "2025-09",
    to: "2025-12",
    skills: [],
    map: [
      [[10, 36], [38, 36], [56, 18], [86, 18]],
      [[30, 8], [30, 24], [46, 40], [72, 40]],
    ],
  },
  {
    id: "latech",
    name: "LA-Tech.org",
    role: "Software Engineer Intern",
    from: "2026-02",
    to: "2026-05",
    skills: ["Node.js", "Express", "MongoDB", "React Native"],
    map: [
      [[8, 12], [34, 12], [54, 32], [88, 32]],
      [[18, 42], [38, 22], [62, 22], [76, 8]],
      [[48, 6], [48, 42]],
      [[8, 26], [26, 26], [40, 40], [66, 40], [82, 24]],
    ],
  },
  {
    id: "csu",
    name: "CSU",
    org: "California State University, Office of the Chancellor",
    role: "Junior Data Operations Development Engineer",
    from: "2026-08",
    skills: ["PySpark", "SQL"],
    map: [
      [[10, 10], [34, 10], [58, 34], [86, 34]],
      [[12, 40], [38, 40], [64, 14], [84, 14]],
    ],
  },
];
// The lines whose colours a job's skills are dotted in, and its picture drawn in, in turn.
const DOTS = ["a", "b", "c", "d", "e", "g", "k"];
const ink = (k) => `--c: var(--line-${DOTS[k % DOTS.length]})`;

// A job's picture: each line with a stop at either end.
const picture = (job) =>
  `<svg class="pic" viewBox="0 0 96 48" aria-hidden="true">${job.map
    .map(
      (line, k) =>
        `<g style="${ink(k)}"><polyline points="${line.join(" ")}"/>${[line[0], line.at(-1)]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`)
          .join("")}</g>`,
    )
    .join("")}</svg>`;

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
      const { kind, place, blurb, stat } = t("jobs")[job.id];
      const when = `${month(job.from)} – ${job.to ? month(job.to) : t("present")}`;
      const skills = job.skills.map((s, k) => `<span class="skill" style="${ink(k)}">${s}</span>`);
      return `<article class="job" data-i="${i}">
        <h2><button>${job.name}</button></h2>
        ${picture(job)}
        <div class="full">
          ${skills.length ? `<div class="skills">${skills.join("")}</div>` : ""}
          <p class="role">${job.role}</p>
          ${job.org ? `<p>${job.org}</p>` : ""}
          <p>${when} · ${kind}</p>
          <p>${place}</p>
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
    if (!e.button) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false };
  });
  jobs.addEventListener("pointermove", (e) => {
    if (swipe?.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    if (!swipe.on) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - swipe.y)) return;
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
    if (jobs.closest(".screen").hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    const by = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!by) return;
    e.preventDefault();
    pick(at + by);
  });

  onLang(build);
}
