// The sound: one soft synthesized piano in a roomy reverb, and nothing recorded. The map plays
// it. A train pulling into a station on screen strikes a note, the menu and the switches play
// short figures, and a low hum sits under the view screen while trains are moving. Every note
// comes off one pentatonic ladder, so whatever lands together is in tune. All of it only while
// the sound pref is on.
import { toScreen } from "./dom.js";
import { clamp } from "./math.js";
import { prefs } from "./prefs.js";

const LADDER = [0, 2, 4, 7, 9];
const LOW = 41;
const RUNG = { B: 0, D: 2, A: 5, E: 7, G: 9, C: 10, K: 12 };
const SPAN = 8;

const GRID = 0.125;
const GAP = 0.25;
const STEP = 0.075;
const PAN = 0.75;
const HUM = [43.65, 65.41];
const LOUD = [0.35, 1, 1.8];
const REVERB = 2.2;
const ROOM = 0.35;
const RING = [0.6, 2.4];
const RING_FALL = 0.035;
const STRIKE = 0.006;
const PEAK = 0.16;
const DETUNE = 4;
const CHIME_VEL = 0.5;
const ARRIVE_VEL = [0.35, 0.3];
const RUNG_ELSE = 5;
const HUM_LEVEL = 0.05;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const rung = (i) =>
  LOW + 12 * Math.floor(i / LADDER.length) + LADDER[i % LADDER.length];

let audio, out, master, room, wave, hum;

// The audio graph, built on first use. Browsers only let that be a click or a key press, so
// until one has happened with sound on, `ready` returns nothing and nothing plays.
const ready = () => (prefs.sound && audio) || null;
function wake() {
  if (!prefs.sound) return;
  if (audio) {
    master.gain.value = LOUD[prefs.volume] ?? 1;
    return void audio.resume();
  }
  audio = new AudioContext();
  out = audio.createDynamicsCompressor();
  master = audio.createGain();
  master.gain.value = LOUD[prefs.volume] ?? 1;
  out.connect(master).connect(audio.destination);
  const len = Math.floor(audio.sampleRate * REVERB),
    ir = audio.createBuffer(2, len, audio.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  room = audio.createGain();
  room.gain.value = ROOM;
  const reverb = audio.createConvolver();
  reverb.buffer = ir;
  room.connect(reverb).connect(out);
  const partials = [0, 1, 0.45, 0.22, 0.12, 0.07, 0.04, 0.02];
  wave = audio.createPeriodicWave(
    new Float32Array(partials),
    new Float32Array(partials.length),
  );
}
for (const type of ["pointerdown", "keydown"])
  addEventListener(type, wake, true);

// One piano note: two strings a hair out of tune, bright as the hammer lands and mellowing as
// they ring, low notes ringing longest. `vel` 0 → 1 is how hard it is struck, `pan` -1 → 1
// where it sits from left to right, `when` how many seconds from now.
function note(midi, { vel = 0.6, pan = 0, when = 0 } = {}) {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime + when,
    f = hz(midi),
    ring = clamp(RING[1] - (midi - LOW) * RING_FALL, ...RING);
  const tone = ctx.createBiquadFilter(),
    amp = ctx.createGain(),
    side = ctx.createStereoPanner();
  tone.frequency.setValueAtTime(Math.min(f * (3 + 7 * vel), 12000), t);
  tone.frequency.setTargetAtTime(f * 2, t, 0.25);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(PEAK * vel, t + STRIKE);
  amp.gain.setTargetAtTime(0, t + STRIKE, ring);
  side.pan.value = clamp(pan, -1, 1);
  for (const cents of [-DETUNE, DETUNE]) {
    const string = ctx.createOscillator();
    string.setPeriodicWave(wave);
    string.frequency.value = f;
    string.detune.value = cents;
    string.connect(tone);
    string.start(t);
    string.stop(t + ring * 5);
  }
  tone.connect(amp).connect(side);
  side.connect(out);
  side.connect(room);
}

// A short figure for the menu and the switches: these MIDI notes, one after another.
export function chime(...notes) {
  wake(); // called from a click, so this is the moment the sound can start
  notes.forEach((midi, k) => note(midi, { vel: CHIME_VEL, when: k * STEP }));
}

// The handler for a train of `line` pulling into station `id`: strikes that station's note in
// the line's register, if the camera sees the station, placed left to right as it is on screen.
// Arrivals land on a beat and never crowd each other, however many trains are in view.
export function arrivals({ stations }, cam) {
  const byId = new Map(stations.map((s) => [s.id, s]));
  let last = 0;
  return (line, id) => {
    const ctx = ready(),
      s = byId.get(id);
    if (!ctx || !s || !cam.sees(s)) return;
    const at = Math.ceil(ctx.currentTime / GRID) * GRID;
    if (at - last < GAP) return;
    last = at;
    const k = Math.max(0, line.stations.indexOf(id)) % (2 * SPAN),
      i = (RUNG[line.id] ?? RUNG_ELSE) + (k < SPAN ? k : 2 * SPAN - k);
    const x = toScreen(s).x / innerWidth;
    note(rung(i), {
      vel: ARRIVE_VEL[0] + ARRIVE_VEL[1] * Math.random(),
      pan: (x * 2 - 1) * PAN,
      when: at - ctx.currentTime,
    });
  };
}

// The hum under the view screen: a low fifth that opens up a little as more of the trains are
// moving. `share` is how many of them are, 0 → 1, or null to let the hum die away.
export function drone(share) {
  const ctx = share == null ? null : ready();
  if (!ctx) {
    hum?.level.gain.setTargetAtTime(0, audio.currentTime, 0.4);
    return;
  }
  if (!hum) {
    const tone = ctx.createBiquadFilter(),
      level = ctx.createGain();
    tone.Q.value = 0.5;
    level.gain.value = 0;
    for (const f of HUM) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      osc.connect(tone);
      osc.start();
    }
    tone.connect(level).connect(out);
    level.connect(room);
    hum = { tone, level };
  }
  const breath = Math.sin(ctx.currentTime * 0.5);
  hum.tone.frequency.setTargetAtTime(
    110 + 140 * share + 25 * breath,
    ctx.currentTime,
    0.5,
  );
  hum.level.gain.setTargetAtTime(HUM_LEVEL, ctx.currentTime, 1.5);
}
