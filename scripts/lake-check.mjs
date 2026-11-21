// Day by day, the rows in the lake against the downloaded archive, since Pipelines drops a
// record that doesn't fit its schema without a word. Also counts doubled rows.
//   BASIN_TOKEN=... node scripts/lake-check.mjs
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basin } from "../worker/lake.js";
import { day } from "../worker/stats.js";
import { ARCHIVE } from "./lib/paths.mjs";

const config = JSON.parse(
  (
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  ).replace(/^\s*\/\/.*$/gm, ""),
);
const env = { ...config.vars, BASIN_TOKEN: process.env.BASIN_TOKEN };
const files = fileURLToPath(new URL("*/*.parquet", ARCHIVE));
const local = JSON.parse(
  execFileSync("duckdb", [
    "-json",
    "-c",
    `SELECT strftime(timezone('America/Los_Angeles', timezone('UTC', sampled_at)), '%Y-%m-%d')
        AS date, count(*) AS rows
      FROM read_parquet('${files}', hive_partitioning = false) GROUP BY 1 ORDER BY 1`,
  ]),
);
const stamp = (at) => `'${new Date(at * 1000).toISOString().slice(0, 19)}Z'`;
let bad = 0;
for (const { date, rows } of local) {
  const d = day(date);
  const window = `FROM metro.vehicle_positions
    WHERE sampled_at >= ${stamp(d.start)} AND sampled_at < ${stamp(d.end)}`;
  const [{ n }] = await basin(env, `SELECT count(*) AS n ${window}`);
  const [{ u }] = await basin(
    env,
    `SELECT count(*) AS u FROM (SELECT DISTINCT sampled_at, vehicle_id ${window}) once`,
  );
  const ok = Number(u) === Number(rows) && Number(n) === Number(u);
  if (!ok) bad++;
  console.log(
    `${date}  archive ${rows}  lake ${n}  once ${u}  ${ok ? "ok" : "DIFFERENT"}`,
  );
}
process.exitCode = bad ? 1 : 0;
