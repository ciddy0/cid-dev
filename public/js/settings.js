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
      chime(prefs[key] ? 880 : 440);
    });
    sync();
  }
}
