// The LA Metro map: draws data/metro.json as a schematic, then hands it to the camera, the
// station label, the trains and the menu that flies between the screens.
import { camera } from "./camera.js";
import { draw } from "./draw.js";
import { stationLabel } from "./label.js";
import { menu } from "./menu.js";
import { loadMap } from "./network.js";
import { settings } from "./settings.js";
import { arrivals } from "./sound.js";
import { trains } from "./trains.js";

settings();
try {
  const map = await loadMap();
  const drawn = draw(map);
  const cam = camera(drawn);
  stationLabel(drawn, cam);
  const { run } = trains(drawn, map, { onArrive: arrivals(drawn, cam) });
  menu(drawn, cam, { onViewing: run });
} catch (err) {
  console.error(err);
  const status = document.getElementById("status");
  status.textContent = "The map couldn't be loaded. Try refreshing.";
  status.hidden = false;
}
