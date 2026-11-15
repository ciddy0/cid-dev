// The intro: as the page opens, each line draws itself in from one end to the other, one line
// starting just after another, its Ts popping in as it sets off and as it arrives.
const STAGGER_MS = 80;
const DRAW_MS = [650, 1150];
const POP_MS = 420;
const LANDED = 0.55;

const OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

// Plays the intro on the `tracks` draw() returned, and returns the ms until the last line has
// landed. Only stroke-dashoffset and transform move, and only while it plays: once done, each
// path is back to how draw() left it.
export function drawIn(tracks) {
  const lens = tracks.map(({ path }) => path.getTotalLength());
  const longest = Math.max(...lens);
  const start = new Map();
  let landed = 0;
  tracks.forEach(({ line, extra, path, caps = [] }, t) => {
    const main = start.get(line);
    const ms = DRAW_MS[0] + (DRAW_MS[1] - DRAW_MS[0]) * (lens[t] / longest);
    const delay = main
      ? main.delay + main.ms * LANDED
      : start.size * STAGGER_MS;
    if (!extra) start.set(line, { delay, ms });
    const dash = lens[t] + 0.1;
    path.animate(
      { strokeDasharray: [dash, dash], strokeDashoffset: [dash, 0] },
      { duration: ms, delay, easing: OUT, fill: "backwards" },
    );
    for (const cap of caps)
      cap.path.animate(
        { transform: ["scale(0)", "scale(1)"] },
        {
          duration: POP_MS,
          delay: delay + (cap.last ? ms * LANDED : 0),
          easing: SPRING,
          fill: "backwards",
        },
      );
    landed = Math.max(landed, delay + ms * LANDED + POP_MS);
  });
  return landed;
}
