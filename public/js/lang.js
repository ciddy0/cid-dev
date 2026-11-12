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
    docsCard: `<h2>What This Is</h2>
      <p>A map of the LA Metro rail network, with the trains where Metro says they are right
        now. Mostly I just wanted something nice to look at.</p>
      <h2>Getting Around</h2>
      <p><b>View</b> opens the map and the trains.</p>
      <p><b>Drag</b> to move, <b>pinch or scroll</b> to zoom.</p>
      <p><b>Tap or hover</b> a station for its name and lines.</p>
      <p><b>Tab</b> steps through the stations.</p>
      <p>The arrow up top (or <b>Esc</b>) brings you back.</p>
      <h2>The Map</h2>
      <p>The lines and stations come from Metro's GTFS feed, the timetable data they publish.</p>
      <p>A script turns that into lines and stations, then snaps every segment to 45° and 90°
        bends and spreads the stations out. The ones that still looked bad got moved by hand.</p>
      <p>It's plain HTML, SVG and JavaScript.</p>
      <h2>The Trains</h2>
      <p>Metro streams where every train is. One small server on Cloudflare keeps the only
        connection to it and sends everyone a snapshot every few seconds, so Metro sees one
        visitor no matter how many of you there are.</p>
      <p>It also saves a snapshot every minute. When you open the map you see the last half hour
        played back in a few seconds, then it settles into live.</p>
      <p>Turn on sound and every train that pulls in plays a note.</p>
      <h2>Limitations</h2>
      <p>It's a schematic, not to scale. Distances are squished and stretched to fit.</p>
      <p>Trains are only as live as Metro's reports, which can be a few minutes old. Trains on a
        layover or with a dead tracker just sit there.</p>
      <p>If the live feed goes quiet for two minutes, the map falls back to the timetable. Those
        trains are where the schedule says, not where they really are.</p>
      <p>The replay needs a recording, so the first visit after I deploy starts without one.</p>
      <p>The J Line isn't drawn yet, and neither is anything under construction.</p>
      <p>Not affiliated with LA Metro. Please don't plan a trip with it.</p>
      <h2>Credits</h2>
      <p>Made by cid</p>
      <p>Data from LA Metro</p>
      <p>Colorblind palette by Okabe &amp; Ito</p>
      <p>Inspired by Beck, Vignelli and Mini Metro</p>`,
    lang: "Language",
    night: "Night Mode",
    colorblind: "Colorblind Mode",
    coast: "Coastline",
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
    station: (name, lines) =>
      `${name}, ${lines.join(", ")} ${lines.length > 1 ? "lines" : "line"}`,
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
    docsCard: `<h2>Qué es esto</h2>
      <p>Un mapa de la red de trenes de LA Metro, con los trenes donde Metro dice que están
        ahorita. Más que nada quería algo bonito para ver.</p>
      <h2>Cómo moverte</h2>
      <p><b>Ver</b> abre el mapa y los trenes.</p>
      <p><b>Arrastra</b> para moverte, <b>pellizca o desplaza</b> para acercar o alejar.</p>
      <p><b>Toca una estación o pasa el cursor</b> sobre ella para ver su nombre y sus
        líneas.</p>
      <p><b>Tab</b> recorre las estaciones.</p>
      <p>La flecha de arriba (o <b>Esc</b>) te regresa.</p>
      <h2>El mapa</h2>
      <p>Las líneas y las estaciones salen del feed GTFS de Metro, los horarios que
        publican.</p>
      <p>Un script los convierte en líneas y estaciones, endereza cada tramo en ángulos de 45° y
        90° y separa las estaciones. Las que todavía se veían mal las acomodé a mano.</p>
      <p>Es puro HTML, SVG y JavaScript.</p>
      <h2>Los trenes</h2>
      <p>Metro transmite dónde está cada tren. Un servidor chiquito en Cloudflare tiene la única
        conexión y le manda a todos una foto cada pocos segundos, así Metro ve un solo visitante
        sin importar cuántos sean.</p>
      <p>También guarda una foto cada minuto. Al abrir el mapa ves la última media hora en unos
        segundos, y luego se queda en vivo.</p>
      <p>Si prendes el sonido, cada tren que llega toca una nota.</p>
      <h2>Limitaciones</h2>
      <p>Es un esquema, no está a escala. Las distancias se aprietan y se estiran para que
        quepa.</p>
      <p>Los trenes son tan en vivo como los reportes de Metro, que pueden tener unos minutos.
        Los trenes en descanso o con el rastreador apagado se quedan quietos.</p>
      <p>Si el feed en vivo se calla dos minutos, el mapa usa los horarios. Esos trenes están
        donde dice el horario, no donde de verdad están.</p>
      <p>La repetición necesita una grabación, así que la primera visita después de que
        actualizo empieza sin ella.</p>
      <p>La Línea J todavía no está dibujada, ni nada de lo que está en construcción.</p>
      <p>No tiene nada que ver con LA Metro. Porfa no planees un viaje con esto.</p>
      <h2>Créditos</h2>
      <p>Hecho por cid</p>
      <p>Datos de LA Metro</p>
      <p>Paleta para daltónicos de Okabe e Ito</p>
      <p>Inspirado en Beck, Vignelli y Mini Metro</p>`,
    lang: "Idioma",
    night: "Modo nocturno",
    colorblind: "Modo daltónico",
    coast: "Costa",
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

const heard = [];
export function onLang(fn) {
  heard.push(fn);
  fn();
}

export function translate() {
  document.documentElement.lang = prefs.lang === "es" ? "es-MX" : "en";
  for (const node of document.querySelectorAll("[data-t]"))
    node.innerHTML = t(node.dataset.t);
  for (const node of document.querySelectorAll("[data-t-label]"))
    node.setAttribute("aria-label", t(node.dataset.tLabel));
  for (const fn of heard) fn();
}
