import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SHEET_ID = "1xlG146EJ3go3MDKndnvd5OVVWj8adZmKCKaWjn3FF3Y";
const PUBLIC_GID = "2140278312";
const EXCLUSIVE_GID = "86343619";
const PODCAST_RU_PAGES = 26;
const PODCAST_RU_BASE = "https://podcast.ru";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linksPath = resolve(root, "data/episode-links.js");
const episodesPath = resolve(root, "data/episodes.js");

// 1. Public episode pages from podcast.ru (title -> {url, date}).
const podcastRuByTitle = new Map();
for (let page = 1; page <= PODCAST_RU_PAGES; page += 1) {
  const html = await fetchText(`${PODCAST_RU_BASE}/1117521635/e?page=${page}`);
  const before = podcastRuByTitle.size;
  for (const match of html.matchAll(/href="(\/e\/[A-Za-z0-9._-]+)"[\s\S]{0,600}?>([^<]{10,160})<[\s\S]{0,400}?(\d{2}\.\d{2}\.\d{4})/g)) {
    const title = clean(decodeHtml(match[2]));
    if (title) podcastRuByTitle.set(normalizeTitle(title), { url: `${PODCAST_RU_BASE}${match[1]}`, date: match[3] });
  }
  if (podcastRuByTitle.size === before && page > 1) break;
}
console.log(`podcast.ru: ${podcastRuByTitle.size} episode pages`);

// 1b. podcast.ru RSS covers episodes missing from the site pages (links point to podster.fm).
const podcastRuRssByTitle = new Map();
const rss = await fetchText(`${PODCAST_RU_BASE}/1117521635/rss`);
for (const match of rss.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
  const item = match[1];
  const title = clean(decodeHtml((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""));
  const link = clean((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
  const pubDate = clean((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
  if (!title || !link) continue;
  const parsed = new Date(pubDate);
  const date = Number.isNaN(parsed)
    ? ""
    : `${String(parsed.getUTCDate()).padStart(2, "0")}.${String(parsed.getUTCMonth() + 1).padStart(2, "0")}.${parsed.getUTCFullYear()}`;
  podcastRuRssByTitle.set(normalizeTitle(title), { url: link, date });
}
console.log(`podcast.ru RSS: ${podcastRuRssByTitle.size} items`);

// 2. Boosty links from the Google Sheet link tabs.
const [publicCsv, exclusiveCsv] = await Promise.all([fetchCsv(PUBLIC_GID), fetchCsv(EXCLUSIVE_GID)]);
const boostyByTitle = new Map();
for (const row of parseCsv(publicCsv)) {
  const title = clean(row[0] || "");
  const boosty = clean(row[3] || "");
  if (title && boosty.startsWith("http")) boostyByTitle.set(normalizeTitle(title), { url: boosty });
}
for (const row of parseCsv(exclusiveCsv)) {
  const title = clean(row[0] || "");
  const boosty = clean(row[2] || "");
  if (title && boosty.startsWith("http")) boostyByTitle.set(normalizeTitle(title), { url: boosty });
}
console.log(`Sheet: ${boostyByTitle.size} Boosty links`);

const episodesPayload = readPayload(await readFile(episodesPath, "utf8"));
const episodeByKey = new Map(
  episodesPayload.episodes.map((episode) => [`${episode.podcast}|${episode.number}`, episode]),
);

// 3. Rewrite the curated links: podcast.ru for public episodes, Boosty as fallback.
const source = await readFile(linksPath, "utf8");
const entries = [...source.matchAll(/^  "((?:[^"\\]|\\.)+)": "([^"]+)",?$/gm)].map((match) => ({
  key: match[1].replaceAll('\\"', '"'),
  url: match[2],
}));

const stats = { podcastRu: 0, boosty: 0, kept: 0, dropped: 0 };
const droppedKeys = [];
const kept = [];
for (const { key, url } of entries) {
  const podcastRu = findByKey(key, podcastRuByTitle) || findByKey(key, podcastRuRssByTitle);
  if (podcastRu) {
    kept.push([key, podcastRu.url]);
    stats.podcastRu += 1;
    continue;
  }
  if (!url.includes("spidermedia.ru")) {
    kept.push([key, url]);
    stats.kept += 1;
    continue;
  }
  const boosty = findByKey(key, boostyByTitle);
  if (boosty) {
    kept.push([key, boosty.url]);
    stats.boosty += 1;
  } else {
    stats.dropped += 1;
    droppedKeys.push(key);
  }
}

// 3b. Add links for episodes that are not in the curated file yet (new releases).
const keptKeys = new Set(kept.map(([key]) => key));
let added = 0;
for (const episode of episodesPayload.episodes) {
  const key = episode.number
    ? `${episode.podcast}|${episode.number}`
    : `${episode.podcast}|${episode.publication}|${episode.title || ""}`;
  if (keptKeys.has(key)) continue;
  const found = findByKey(key, podcastRuByTitle) || findByKey(key, podcastRuRssByTitle) || findByKey(key, boostyByTitle);
  if (!found) continue;
  kept.push([key, found.url]);
  keptKeys.add(key);
  added += 1;
}
if (added) console.log(`Added ${added} new episode links`);

kept.sort((a, b) => a[0].localeCompare(b[0], "ru"));
const body = kept.map(([key, url]) => `  ${JSON.stringify(key)}: ${JSON.stringify(url)},`).join("\n");
const output = `// Source: podcast.ru public pages, then Google Sheets tabs ${PUBLIC_GID} (public) and ${EXCLUSIVE_GID} (exclusive).
// spidermedia.ru went offline; its links were replaced or removed.
export default {
${body}
};
`;
await writeFile(linksPath, output, "utf8");
console.log(
  `Kept ${kept.length} links: ${stats.podcastRu} podcast.ru, ${stats.boosty} Boosty from the sheet, ${stats.kept} untouched, ${stats.dropped} dropped.`,
);
if (droppedKeys.length) console.log(`Dropped: ${droppedKeys.join(", ")}`);

function findByKey(key, byTitle) {
  const parts = key.split("|");
  const podcast = parts[0];
  let number = parts[1] || "";
  let publication = "";
  let titleFromKey = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(number)) {
    publication = number;
    number = "";
    titleFromKey = parts.slice(2).join("|");
  }

  let match;
  if ((match = podcast === "На панелях" && number.match(/^(\d+)$/))) {
    return lookupPrefix(byTitle, normalizeTitle(`«На панелях». Выпуск ${String(Number(match[1])).padStart(2, "0")}`));
  }
  if ((match = podcast === "На пыльных панелях" && number.match(/^D(\d+)$/))) {
    return lookupPrefix(byTitle, normalizeTitle(`«На пыльных панелях». Выпуск ${String(Number(match[1])).padStart(2, "0")}`));
  }
  if ((match = podcast === "Лайт" && number.match(/^L(\d+)$/))) {
    return lookupPrefix(byTitle, normalizeTitle(`«На панелях. Лайт». Выпуск ${String(Number(match[1])).padStart(2, "0")}`));
  }
  const bracketFormats = {
    "Panels of X": [/^PoX(\d+)$/, "Panels of X"],
    "X of Panels": [/^XoP(\d+)$/, "X of Panels"],
    "Hellfire Panels": [/^HP(\d+)$/, "Hellfire Panels"],
    "Inferno Panels": [/^IP(\d+)$/, "Inferno Panels"],
  };
  const bracket = bracketFormats[podcast];
  if (bracket && (match = number.match(bracket[0]))) {
    return lookupPrefix(byTitle, normalizeTitle(`${bracket[1]} [${String(Number(match[1])).padStart(2, "0")}]`));
  }
  if ((match = podcast === "Ultimate Panels" && number.match(/^UP(\d+)$/))) {
    return lookupPrefix(byTitle, normalizeTitle(`Ultimate Panels (${String(Number(match[1])).padStart(2, "0")})`));
  }
  if (podcast === "Gol D. Panels") {
    const episode = episodeByKey.get(`${podcast}|${number}`);
    if (episode?.title) {
      const direct = byTitle.get(normalizeTitle(episode.title));
      if (direct) return direct;
    }
    const date = episode?.publication || publication;
    if (date) return lookupByDatePrefix(byTitle, "gol d. panels", date);
    return null;
  }
  if (titleFromKey) {
    const direct = byTitle.get(normalizeTitle(titleFromKey));
    if (direct) return direct;
    if (publication) {
      const byDate = lookupByDatePrefix(byTitle, normalizeTitle(titleFromKey).slice(0, 24), publication);
      if (byDate) return byDate;
    }
  }
  const episode = episodeByKey.get(`${podcast}|${number}`);
  if (episode?.title) {
    const direct = byTitle.get(normalizeTitle(episode.title));
    if (direct) return direct;
    return lookupPrefix(byTitle, normalizeTitle(episode.title));
  }
  return null;
}

function lookupPrefix(byTitle, normalizedPrefix) {
  for (const [title, value] of byTitle) {
    if (title === normalizedPrefix || title.startsWith(`${normalizedPrefix}:`)) return value;
  }
  return null;
}

function lookupByDatePrefix(byTitle, normalizedPrefix, publication) {
  const [year, month, day] = publication.split("-");
  const wanted = `${day}.${month}.${year}`;
  for (const [title, value] of byTitle) {
    if (title.startsWith(normalizedPrefix) && value.date === wanted) return value;
  }
  return null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "panels-hiatus-links-sync/1.0" },
    signal: AbortSignal.timeout(180_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function fetchCsv(gid) {
  return fetchText(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`);
}

function readPayload(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: episodesPath });
  return context.window.__NA_PANELI_DATA__;
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

function normalizeTitle(value) {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function clean(value = "") {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
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
