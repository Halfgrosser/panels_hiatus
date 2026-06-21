import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = "1xlG146EJ3go3MDKndnvd5OVVWj8adZmKCKaWjn3FF3Y";
const SHEET_GID = "0";
const sourceUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const rssUrl = process.env.BOOSTY_RSS_URL;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "data/episodes.js");

if (!rssUrl && !process.env.SYNC_RSS_FILE) {
  throw new Error("Set BOOSTY_RSS_URL or SYNC_RSS_FILE to load the RSS feed");
}

const [csv, rss] = await Promise.all([
  loadSource(sourceUrl, "Google Sheets", process.env.SYNC_SHEET_FILE),
  loadSource(rssUrl, "Boosty RSS", process.env.SYNC_RSS_FILE),
]);
const [header, ...records] = parseCsv(csv);
const rows = records.map((record) => Object.fromEntries(header.map((name, index) => [name, record[index] || ""])));

const sheetEpisodes = rows
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
    source: "google-sheet",
  }));

const rssItems = parseRss(rss).filter((item) => !isRawRecording(item.title));
const rssEpisodes = rssItems
  .filter((item) => !isRepresentedInSheet(item, sheetEpisodes))
  .map(toRssEpisode);

const episodes = [...sheetEpisodes, ...rssEpisodes].sort(
  (a, b) =>
    a.publication.localeCompare(b.publication) ||
    (a.id || Number.MAX_SAFE_INTEGER) - (b.id || Number.MAX_SAFE_INTEGER) ||
    (a.title || "").localeCompare(b.title || "", "ru"),
);

if (episodes.length < 50) throw new Error(`Only ${episodes.length} episodes parsed; refusing to overwrite data`);

const payload = {
  source: sourceUrl,
  updatedAt: new Date().toISOString().slice(0, 10),
  episodes,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `window.__NA_PANELI_DATA__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
console.log(`Saved ${episodes.length} episodes (${sheetEpisodes.length} from the sheet, ${rssEpisodes.length} RSS-only) to ${output}`);

async function loadSource(url, label, localPath) {
  if (localPath) return readFile(localPath, "utf8");
  const response = await fetch(url, {
    headers: { "User-Agent": "panels-hiatus-data-sync/1.0" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
  return response.text();
}

function parseRss(input) {
  return [...input.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
    title: xmlTag(item, "title"),
    description: stripHtml(xmlTag(item, "description")),
    link: xmlTag(item, "link"),
    guid: xmlTag(item, "guid"),
    publication: new Date(xmlTag(item, "pubDate")).toISOString().slice(0, 10),
  }));
}

function isRawRecording(title) {
  return /сырой звук|сырая версия|сырая запись/i.test(title);
}

function isRepresentedInSheet(item, sheetEpisodes) {
  const identity = titleIdentity(item.title);
  if (identity) {
    return sheetEpisodes.some(
      (episode) =>
        episode.podcast.toLocaleLowerCase("ru") === identity.podcast.toLocaleLowerCase("ru") &&
        episode.number.toLocaleLowerCase("ru") === identity.number.toLocaleLowerCase("ru"),
    );
  }

  if (/^Gol D\. Panels\b/i.test(item.title)) {
    return sheetEpisodes.some((episode) => episode.publication === item.publication && episode.podcast === "Gol D. Panels");
  }

  return false;
}

function titleIdentity(title) {
  const patterns = [
    [/^«На панелях»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "На панелях", number })],
    [/^«На пыльных панелях»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "Пыльник", number: `D${number}` })],
    [/^«На панелях\. Лайт»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "Лайт", number: `L${number}` })],
    [/^Amazing Screw-On Podcast\s*#0*(\d+)/i, (number) => ({ podcast: "ASOP", number: `M${number}` })],
    [/^Утешительное чтение\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "Утешительный", number: `LR${number}` })],
    [/^Ultimate Panels\s*\(0*(\d+)\)/i, (number) => ({ podcast: "Ultimate Panels", number: `UP${number}` })],
  ];

  for (const [pattern, create] of patterns) {
    const match = title.match(pattern);
    if (match) return create(String(Number(match[1])));
  }
  return null;
}

function toRssEpisode(item) {
  const identity = titleIdentity(item.title);
  const inferred = inferRssFormat(item.title);
  return {
    id: null,
    podcast: identity?.podcast || inferred.podcast,
    number: identity?.number || inferred.number,
    publication: item.publication,
    title: item.title,
    topics: [],
    participants: "",
    comment: item.description,
    supportersOnly: true,
    supportersFree: false,
    source: "boosty-rss",
    link: item.link,
    guid: item.guid,
  };
}

function inferRssFormat(title) {
  const formats = [
    [/^«На панелях\. ДНК»/i, "На панелях. ДНК", ""],
    [/^X-Club\s+([\d.]+)/i, "X-Club"],
    [/^The Podcast of Zelda\s*#0*(\d+)/i, "The Podcast of Zelda"],
    [/^Avatar Club\. Book\s*0*(\d+)/i, "Avatar Club"],
    [/^Письма от слушателей\. Выпуск\s*0*(\d+)/i, "Письма от слушателей"],
    [/^Проч[её]л, приш[её]л и рассказал/i, "Прочёл, пришёл и рассказал", ""],
    [/^Посмотрел, приш[её]л и рассказал/i, "Посмотрел, пришёл и рассказал", ""],
    [/^Метатекст моя отсылка/i, "Метатекст моя отсылка", ""],
    [/^Тула LIVE/i, "Тула LIVE", ""],
    [/^Бонусная часть/i, "Бонус", ""],
    [/^«На \(звуковых\) полях»/i, "На звуковых полях", ""],
  ];

  for (const [pattern, podcast, fixedNumber] of formats) {
    const match = title.match(pattern);
    if (match) return { podcast, number: fixedNumber ?? match[1] ?? "" };
  }
  return { podcast: "Спецвыпуск", number: "" };
}

function xmlTag(input, tag) {
  const match = input.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(decodeXml((match?.[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "")));
}

function decodeXml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function stripHtml(value) {
  return clean(value.replace(/<[^>]+>/g, " "));
}

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
