// The settings screen: every [data-pref] switch flips the pref it names, and every [data-pref]
// stepper walks its pref along the values listed for it here.
import { onLang, t, translate } from "./lang.js";
import { prefs, setPref } from "./prefs.js";
import { chime } from "./sound.js";

const STEPS = {
  lang: { values: ["en", "es"], name: (v) => ({ en: "English", es: "Español" })[v] },
  volume: { values: [0, 1, 2], name: (v) => t(["low", "medium", "high"][v]) },
};
const CHIME_UP = [74, 81]; // MIDI notes: D5 up to A5
const CHIME_DOWN = [74, 69];

export function settings() {
  translate();
  for (const sw of document.querySelectorAll(".switch[data-pref]")) {
    const key = sw.dataset.pref;
    const sync = () => sw.setAttribute("aria-checked", prefs[key]);
    sw.addEventListener("click", () => {
      setPref(key, !prefs[key]);
      sync();
      chime(...(prefs[key] ? CHIME_UP : CHIME_DOWN));
    });
    sync();
  }
  for (const stepper of document.querySelectorAll(".stepper[data-pref]")) {
    const key = stepper.dataset.pref,
      { values, name } = STEPS[key],
      shown = stepper.querySelector("output");
    const at = () => values.indexOf(prefs[key]);
    // An arrow with nowhere left to go stays focusable, but greys out.
    const sync = () => {
      shown.textContent = name(prefs[key]) ?? "";
      for (const arrow of stepper.querySelectorAll("[data-by]"))
        arrow.setAttribute("aria-disabled", !(at() + +arrow.dataset.by in values));
    };
    stepper.addEventListener("click", (e) => {
      const by = +e.target.closest("[data-by]")?.dataset.by,
        to = at() + by;
      if (!(to in values)) return;
      setPref(key, values[to]);
      translate(); // which runs every stepper's sync
      chime(...(by > 0 ? CHIME_UP : CHIME_DOWN));
    });
    onLang(sync);
  }
}
