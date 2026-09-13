import { readFileSync, writeFileSync } from 'node:fs';
import { readOsmPbf } from './pbf-reader.mjs';
const data = readFileSync(new URL('./data/asia-uzbekistan-latest.osm.pbf', import.meta.url));
const signals = [];
readOsmPbf(data, {
  node(id, lat, lon, tags) {
    if (lat >= 40.03 && lat <= 40.19 && lon >= 65.28 && lon <= 65.48 && tags?.highway === 'traffic_signals') {
      signals.push({ id, lat, lon });
    }
  },
});
writeFileSync(new URL('../../apps/client/public/osm/signals.json', import.meta.url), JSON.stringify({
  source: 'OpenStreetMap, ODbL 1.0; local Uzbekistan extract',
  note: 'Surveyed OSM node coordinates. Signal heads, approach offsets and timing are simulated.', signals,
}));
console.log(`${signals.length} OSM traffic-signal nodes`);
