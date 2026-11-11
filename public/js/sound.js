import { prefs } from "./prefs.js";

let audio;

// A short soft tone at `hz`, if sound is on.
export function chime(hz) {
  if (!prefs.sound) return;
  audio ??= new AudioContext();
  const t = audio.currentTime,
    osc = audio.createOscillator(),
    gain = audio.createGain();
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.12, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.5);
}
