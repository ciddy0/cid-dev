// The page's words, in English and in Mexican Spanish. In index.html an element's data-t names the
// words that fill it, and its data-t-label the words of its aria-label. Scripts ask `t`.
import { prefs } from "./prefs.js";

const TEXT = {
  en: {
    map: "Schematic map of the LA Metro rail network",
    menu: "Menu",
    back: "Back to the menu",
    view: "View",
    resume: "Resume",
    docs: "Docs",
    settings: "Settings",
    resumeCard: `<h1>Resume</h1><p>Coming soon.</p>`,
    docsCard: `<h1>Docs</h1>
      <p>A schematic of the LA Metro rail network, drawn from Metro's published timetable
        data and straightened onto 45° and 90° bends.</p>
      <ul>
        <li><b>View</b> pulls back to the whole network.</li>
        <li><b>Drag</b> to move around, <b>pinch or scroll</b> to zoom.</li>
        <li><b>Tap or hover</b> a station for its name and lines.</li>
        <li><b>Tab</b> steps through stations along each line.</li>
        <li>The arrow in the corner (or <b>Esc</b>) brings you back here.</li>
      </ul>`,
    lang: "Language",
    night: "Night Mode",
    colorblind: "Colorblind Mode",
    motion: "Motion",
    sound: "Sound",
    volume: "Volume",
    low: "Low",
    medium: "Medium",
    high: "High",
    previous: "Previous",
    next: "Next",
    quieter: "Quieter",
    louder: "Louder",
    station: (name, lines) => `${name}, ${lines.join(", ")} ${lines.length > 1 ? "lines" : "line"}`,
    failed: "The map couldn't be loaded. Try refreshing.",
  },
  es: {
    map: "Mapa esquemático de la red de trenes de LA Metro",
    menu: "Menú",
    back: "Volver al menú",
    view: "Ver",
    resume: "Currículum",
    docs: "Guía",
    settings: "Configuración",
    resumeCard: `<h1>Currículum</h1><p>Próximamente.</p>`,
    docsCard: `<h1>Guía</h1>
      <p>Un esquema de la red de trenes de LA Metro, dibujado a partir de los horarios que
        publica Metro y enderezado en ángulos de 45° y 90°.</p>
      <ul>
        <li><b>Ver</b> se aleja hasta mostrar toda la red.</li>
        <li><b>Arrastra</b> para moverte, <b>pellizca o desplaza</b> para acercar o alejar.</li>
        <li><b>Toca una estación o pasa el cursor</b> sobre ella para ver su nombre y sus
          líneas.</li>
        <li><b>Tab</b> recorre las estaciones de cada línea.</li>
        <li>La flecha de la esquina (o <b>Esc</b>) te regresa aquí.</li>
      </ul>`,
    lang: "Idioma",
    night: "Modo nocturno",
    colorblind: "Modo daltónico",
    motion: "Movimiento",
    sound: "Sonido",
    volume: "Volumen",
    low: "Bajo",
    medium: "Medio",
    high: "Alto",
    previous: "Anterior",
    next: "Siguiente",
    quieter: "Más bajo",
    louder: "Más alto",
    station: (name, lines) =>
      `${name}, ${lines.length > 1 ? "líneas" : "línea"} ${lines.join(", ")}`,
    failed: "No se pudo cargar el mapa. Intenta actualizar la página.",
  },
};

export function t(key, ...args) {
  const words = (TEXT[prefs.lang] ?? TEXT.en)[key];
  return typeof words === "function" ? words(...args) : words;
}

// `fn` is run now, and again each time the language changes.
const heard = [];
export function onLang(fn) {
  heard.push(fn);
  fn();
}

// Puts the page into the language of the lang pref.
export function translate() {
  document.documentElement.lang = prefs.lang === "es" ? "es-MX" : "en";
  for (const node of document.querySelectorAll("[data-t]")) node.innerHTML = t(node.dataset.t);
  for (const node of document.querySelectorAll("[data-t-label]"))
    node.setAttribute("aria-label", t(node.dataset.tLabel));
  for (const fn of heard) fn();
}
