// Motion and sound, as set on the settings screen and kept in localStorage. Until the visitor
// picks, motion follows the system's preference. With motion off the page is `.calm`.
const KEY = "prefs";

export const prefs = {
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  sound: false,
};
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)));
} catch {}

const apply = () => document.documentElement.classList.toggle("calm", !prefs.motion);

export function setPref(key, on) {
  prefs[key] = on;
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

apply();
