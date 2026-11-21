// The stats screen: for the day picked, how many trains were out, hour by hour, a block a line.
// The numbers come from /stats: stats/latest.json in R2, which the daily job in worker/lake.js writes.
import { onLang, t } from "./lang.js";
import { lineColor, lineInk } from "./network.js";
import { prefs } from "./prefs.js";
import { chime } from "./sound.js";

const DAY_MINUTES = 1440;
const ENOUGH = 0.5;
const CHIME_UP = [74, 81];
const CHIME_DOWN = [74, 69];

const locale = () => (prefs.lang === "es" ? "es-MX" : "en-US");
const day = (date) =>
  new Date(`${date}T12:00`).toLocaleDateString(locale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const hour = (date, h) =>
  new Date(`${date}T${String(h).padStart(2, "0")}:00`).toLocaleTimeString(
    locale(),
    { hour: "numeric" },
  );

function node(tag, className, text) {
  const made = document.createElement(tag);
  if (className) made.className = className;
  if (text != null) made.textContent = text;
  return made;
}

export async function stats(map) {
  const root = document.querySelector(".stats"),
    stepper = root.querySelector(".stepper"),
    shown = stepper.querySelector("output"),
    most = root.querySelector(".stat"),
    chart = root.querySelector(".chart"),
    axis = root.querySelector(".axis"),
    readout = root.querySelector(".readout"),
    caption = root.querySelector(".caption"),
    list = root.querySelector(".lines"),
    note = root.querySelector(".note");

  const days = await fetch("/stats")
    .then((res) => (res.ok ? res.json() : {}))
    .then((json) => json.days ?? [])
    .catch(() => []);
  const full = days.findLastIndex((d) => d.minutes >= ENOUGH * DAY_MINUTES);
  let at = full < 0 ? days.length - 1 : full;

  function show() {
    const d = days[at];
    root.classList.toggle("empty", !d);
    if (!d) return (note.textContent = t("statsNone"));

    const lines = map.lines.filter((line) => d.lines[line.route]);
    const count = (line, h) => d.lines[line.route][h];
    const totals = Array.from({ length: 24 }, (_, h) =>
      lines.reduce((sum, line) => sum + (count(line, h) ?? 0), 0),
    );
    const recorded = (h) => lines.some((line) => count(line, h) != null);
    const top = Math.max(...totals, 1),
      busiest = totals.indexOf(Math.max(...totals));
    const title = t("statsChart");

    shown.textContent = day(d.date);
    for (const arrow of stepper.querySelectorAll("[data-by]"))
      arrow.setAttribute("aria-disabled", !(at + +arrow.dataset.by in days));
    most.firstChild.textContent = totals[busiest];
    most.lastChild.textContent = t("statsMost", hour(d.date, busiest));

    chart.setAttribute("aria-label", title);
    chart.replaceChildren(
      ...Array.from({ length: 24 }, (_, h) => {
        const column = node("div", "hour");
        column.dataset.hour = h;
        for (const line of lines) {
          const n = count(line, h);
          if (!n) continue;
          const block = node("i");
          block.style.height = `${(n / top) * 100}%`;
          block.style.background = lineColor(line);
          column.append(block);
        }
        return column;
      }),
    );
    axis.replaceChildren(
      ...[0, 6, 12, 18].map((h) => node("span", "", hour(d.date, h))),
    );
    list.replaceChildren(
      ...lines.map((line) => {
        const row = node("li"),
          chip = node("span", "chip", line.id);
        chip.style.background = lineColor(line);
        chip.style.color = lineInk(line);
        row.append(
          chip,
          node("span", "name", t("statsLine", line.id)),
          node("b"),
        );
        return row;
      }),
    );
    // With no hour picked, the lines' numbers are the busiest hour's, which the headline is.
    const say = (picked) => {
      const h = picked ?? busiest,
        when = hour(d.date, h);
      for (const column of chart.children)
        column.classList.toggle(
          "dim",
          picked != null && +column.dataset.hour !== picked,
        );
      readout.textContent =
        picked == null ? title : t("statsHour", when, totals[h]);
      caption.textContent = t("statsAt", when);
      for (const [i, line] of lines.entries())
        list.children[i].lastChild.textContent = count(line, h) ?? 0;
    };
    chart.onpointermove = chart.onpointerdown = (e) => {
      const h = e.target.closest(".hour")?.dataset.hour;
      say(h != null && recorded(+h) ? +h : undefined);
    };
    chart.onpointerleave = (e) => {
      if (e.pointerType === "mouse") say(); // a finger's pick stays up
    };
    say();

    note.textContent = t(
      "statsNote",
      Math.min(100, Math.round((d.minutes / DAY_MINUTES) * 100)),
    );
  }

  stepper.addEventListener("click", (e) => {
    const by = +e.target.closest("[data-by]")?.dataset.by;
    if (!(at + by in days)) return;
    at += by;
    show();
    chime(...(by > 0 ? CHIME_UP : CHIME_DOWN));
  });
  onLang(show);
}
