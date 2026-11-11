// What the settings screen sets, kept in localStorage. Until the visitor picks, motion and
// language follow the system's. With motion off the page is `.calm`, with night mode off it is
// `.day`, and in colorblind mode it is `.cb`.
const KEY = "prefs";

export const prefs = {
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  sound: false,
  night: true,
  colorblind: false,
  lang: navigator.language?.startsWith("es") ? "es" : "en",
  volume: 1, // an index into the settings screen's Low / Medium / High
};
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)));
} catch {}

const apply = () => {
  document.documentElement.classList.toggle("calm", !prefs.motion);
  document.documentElement.classList.toggle("day", !prefs.night);
  document.documentElement.classList.toggle("cb", prefs.colorblind);
};

export function setPref(key, value) {
  prefs[key] = value;
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

apply();
