// Where the data pipeline reads and writes.
export const RAW = new URL("../../data/raw/", import.meta.url); // fetched GTFS, not committed
export const RAW_BUS = new URL("bus/", RAW); // the busway rows cut out of the bus feed
export const SOURCE_STAMP = new URL("_source.json", RAW); // which commit of each feed that is
export const ARCHIVE = new URL("archive/", RAW); // the hub's Parquet files, downloaded from R2
export const OVERRIDES = new URL("../../data/overrides.json", import.meta.url);
export const MAP_JSON = new URL(
  "../../public/data/metro.json",
  import.meta.url,
);
export const STATS_JSON = new URL(
  "../../public/data/stats.json",
  import.meta.url,
);
