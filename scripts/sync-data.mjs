import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = "1xlG146EJ3go3MDKndnvd5OVVWj8adZmKCKaWjn3FF3Y";
const SHEET_GID = "0";
const sourceUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/episodes.js");

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);

const csv = await response.text();
const [header, ...records] = parseCsv(csv);
const rows = records.map((record) => Object.fromEntries(header.map((name, index) => [name, record[index] || ""])));

const episodes = rows
  .filter((row) => row["Подкаст"].trim() && /^\d{2}\.\d{2}\.\d{2}$/.test(row["Публикация"].trim()))
  .map((row) => ({
    id: Number(row[""]) || null,
    podcast: clean(row["Подкаст"]),
    number: clean(row["#"]),
    publication: toIsoDate(row["Публикация"]),
    topics: [row["Стас"], row["Леша"], row["Серега"], row["Слушатели"]]
      .map(clean)
      .filter((value) => value && value !== "-"),
    participants: clean(row["Участники"]),
    comment: clean(row["Комментарий"]),
    supportersOnly: isMarked(row["Доступно только\nна Patreon / Boosty"]),
    supportersFree: isMarked(row["В свободном доступе\nна Patreon / Boosty"]),
  }))
  .sort((a, b) => a.publication.localeCompare(b.publication) || (a.id || 0) - (b.id || 0));

if (episodes.length < 50) throw new Error(`Only ${episodes.length} episodes parsed; refusing to overwrite data`);

const payload = {
  source: sourceUrl,
  updatedAt: new Date().toISOString().slice(0, 10),
  episodes,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `window.__NA_PANELI_DATA__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
console.log(`Saved ${episodes.length} episodes to ${output}`);

function clean(value = "") {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function isMarked(value = "") {
  const normalized = clean(value).toLowerCase();
  return Boolean(normalized && !["-", "нет", "0", "false"].includes(normalized));
}

function toIsoDate(value) {
  const [day, month, year] = value.split(".").map(Number);
  return `20${String(year).padStart(2, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
