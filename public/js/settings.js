// The settings screen: every [data-pref] switch flips the pref it names.
import { prefs, setPref } from "./prefs.js";
import { chime } from "./sound.js";

export function settings() {
  for (const sw of document.querySelectorAll("[data-pref]")) {
    const key = sw.dataset.pref;
    const sync = () => sw.setAttribute("aria-checked", prefs[key]);
    sw.addEventListener("click", () => {
      setPref(key, !prefs[key]);
      sync();
      chime(...(prefs[key] ? [74, 81] : [74, 69])); // D5 up to A5, or down to A4
    });
    sync();
  }
}
