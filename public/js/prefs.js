const KEY = "prefs";

export const prefs = {
  motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  sound: false,
  night: true,
  colorblind: false,
  coast: true,
  lang: navigator.language?.startsWith("es") ? "es" : "en",
  volume: 1,
};
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(KEY)));
} catch {}

const apply = () => {
  document.documentElement.classList.toggle("calm", !prefs.motion);
  document.documentElement.classList.toggle("day", !prefs.night);
  document.documentElement.classList.toggle("cb", prefs.colorblind);
  document.documentElement.classList.toggle("bare", !prefs.coast);
  const theme = document.querySelector('meta[name="theme-color"]'),
    bg = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim();
  if (theme && bg) theme.content = bg;
};

export function setPref(key, value) {
  prefs[key] = value;
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

apply();
