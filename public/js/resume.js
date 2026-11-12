// The resume screen: my jobs as stops along a line across the screen, oldest on the left. The
// picked one is raised into a card on the line, the others wait faded either side of it, and
// the strip slides to bring another in: tap it, use the arrows on the line or the arrow keys,
// or swipe.
import { onLang, t } from "./lang.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

// What stays the same in every language. The rest of a job's words are under `jobs` in
// lang.js, by id. A job with no `to` is the one I'm still at.
const JOBS = [
  {
    id: "unite",
    name: "UNITE-LA",
    role: "Cleantech Intern",
    from: "2025-09",
    to: "2025-12",
    skills: [],
  },
  {
    id: "latech",
    name: "LA-Tech.org",
    role: "Software Engineer Intern",
    from: "2026-02",
    to: "2026-05",
    skills: ["Node.js", "Express", "MongoDB", "React Native"],
  },
  {
    id: "csu",
    name: "CSU",
    org: "California State University, Office of the Chancellor",
    role: "Junior Data Operations Development Engineer",
    from: "2026-08",
    skills: ["PySpark", "SQL"],
  },
];
// The lines whose colours a job's skills are dotted in, in turn.
const DOTS = ["a", "b", "c", "d", "e", "g", "k"];

const SWIPE = 48; // px a swipe travels to move on a job
const STRETCH = 0.35; // how far the strip follows a swipe past either end
const CHIME_LATER = [72, 76]; // MIDI notes: C5 up to E5
const CHIME_EARLIER = [72, 67];

export function resume() {
  const jobs = document.querySelector("#resume .jobs"),
    strip = jobs.querySelector(".strip"),
    arrows = jobs.querySelectorAll("[data-by]");
  let at = JOBS.length - 1;

  const month = (ym) =>
    new Intl.DateTimeFormat(prefs.lang === "es" ? "es-MX" : "en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${ym}-15`));

  function build() {
    strip.innerHTML = JOBS.map((job, i) => {
      const { kind, place, points } = t("jobs")[job.id];
      const when = `${month(job.from)} – ${job.to ? month(job.to) : t("present")}`;
      const skills = job.skills.map(
        (s, k) => `<span class="skill" style="--c: var(--line-${DOTS[k % DOTS.length]})">${s}</span>`,
      );
      return `<article class="job" data-i="${i}">
        <h2><button>${job.name}</button></h2>
        <div class="on-line"><span class="stop"></span>${skills.join("")}</div>
        <p class="role">${job.role}</p>
        ${job.org ? `<p class="more">${job.org}</p>` : ""}
        <p class="when">${when}<span class="more"> · ${kind}</span></p>
        <p class="more">${place}</p>
        ${points.length ? `<ul class="more">${points.map((p) => `<li>${p}</li>`).join("")}</ul>` : ""}
      </article>`;
    }).join("");
    show();
  }

  // Only the picked job's name is in the tab order: the arrows walk the rest.
  const named = () => strip.children[at].querySelector("button");
  function show() {
    strip.style.setProperty("--at", at);
    strip.querySelectorAll(".job").forEach((node, i) => {
      node.classList.toggle("on", i === at);
      const name = node.querySelector("button");
      name.tabIndex = i === at ? 0 : -1;
      if (i === at) name.setAttribute("aria-current", "true");
      else name.removeAttribute("aria-current");
    });
    for (const arrow of arrows) arrow.classList.toggle("end", !(at + +arrow.dataset.by in JOBS));
  }

  // Focus stays with what had it: a job's name moves on to the new job's, and an arrow that
  // reached the end of the line hands it to the new job's name.
  function pick(i) {
    if (i === at || !(i in JOBS)) return;
    const had = document.activeElement;
    chime(...(i > at ? CHIME_LATER : CHIME_EARLIER));
    at = i;
    show();
    if (had?.closest(".job") || had?.classList.contains("end"))
      named().focus({ preventScroll: true });
  }

  // A swipe drags the strip along with it, then lets go onto the next job if it went far
  // enough. Up and down are left to the browser, which scrolls a card too tall for the screen.
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
    if (Math.abs(dx) > SWIPE) pick(at - Math.sign(dx));
  };
  jobs.addEventListener("pointerup", lift);
  jobs.addEventListener("pointercancel", lift);

  jobs.addEventListener("click", (e) => {
    if (swiped) return;
    const by = e.target.closest("[data-by]")?.dataset.by,
      job = e.target.closest(".job");
    if (by) pick(at + +by);
    else if (job) pick(+job.dataset.i);
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
