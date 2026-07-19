import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SHEET_ID = "1xlG146EJ3go3MDKndnvd5OVVWj8adZmKCKaWjn3FF3Y";
const SHEET_GID = "0";
const sourceUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const episodesPath = resolve(root, "data/episodes.js");
const comicsPath = resolve(root, "data/comics.js");
const commonRequestEpisodeIds = new Set([
  14, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 53, 54, 55, 58, 59, 60, 62, 63, 66, 67, 70, 75, 78, 79, 80,
  81, 82, 83, 84, 85, 86, 87, 88, 96, 100, 103, 104, 105, 106, 107, 108, 109, 110, 112, 113, 114, 115, 116,
  118, 119, 120, 121, 123, 124, 125, 126, 127, 129, 130, 132, 136, 154, 157, 158, 161, 162, 165, 168, 172, 173,
  174, 175, 178, 181, 182, 183, 184, 186, 190, 192, 194, 195, 196, 197, 198, 200, 203, 204, 209, 212, 213, 215,
  219, 223, 224, 225, 226, 228, 230, 231,
]);
const comicOverridesByEpisode = new Map([
  [
    "ASOP|M18",
    [
      "Lady Baltimore: The Daughters of Medusa",
      "Lands Unknown: The Skinless Man",
      "Leonide the Vampyr: The House of Yonda",
      "Lady Baltimore: The Dream of Ikelos",
      "I Hate Fairyland #42",
    ],
  ],
  [
    "ASOP|M20",
    [
      "ZombieWorld: Champion of the Worms",
      "Fearless Dawn Meets Hellboy",
    ],
  ],
]);

const csv = process.env.SYNC_SHEET_FILE
  ? await readFile(process.env.SYNC_SHEET_FILE, "utf8")
  : await loadSheet();
const [header, ...records] = parseCsv(csv);
const rows = buildSheetRows(header, records);

const sheetById = new Map();
const sheetByIdentity = new Map();
for (const { row, proposerColumns } of rows) {
  const id = Number(row[""]) || null;
  const comics = extractComicEntries(row, id, proposerColumns);
  const entry = {
    id,
    podcast: canonicalPodcast(clean(row["Подкаст"])),
    number: clean(row["#"]),
    publication: correctPublication(clean(row["Подкаст"]), clean(row["#"]), toIsoDate(row["Публикация"])),
    comics,
    topics: comics.map((comic) => comic.title),
  };
  if (entry.id) sheetById.set(entry.id, entry);
  sheetByIdentity.set(episodeIdentity(entry), entry);
}

const payload = readPayload(await readFile(episodesPath, "utf8"));
const existingComics = readExistingComics(await readFile(comicsPath, "utf8"));
const episodes = payload.episodes
  .map((episode) => {
    const source = (episode.id && sheetById.get(episode.id)) || sheetByIdentity.get(episodeIdentity(episode));
    if (!source) return episode;
    return {
      ...episode,
      topics: source.topics,
      comics: source.comics,
    };
  })
  .map(applyComicCorrections);

const updatedAt = new Date().toISOString().slice(0, 10);
const episodesPayload = {
  ...payload,
  source: payload.source || sourceUrl,
  updatedAt,
  episodes,
};
const comicsPayload = {
  source: sourceUrl,
  updatedAt,
  comics: buildComicsCatalog(episodes, existingComics),
};

await writeFile(episodesPath, `window.__NA_PANELI_DATA__ = ${JSON.stringify(episodesPayload, null, 2)};\n`, "utf8");
await writeFile(comicsPath, `window.__NA_PANELI_COMICS__ = ${JSON.stringify(comicsPayload, null, 2)};\n`, "utf8");

console.log(`Updated comic links in ${episodes.length} episodes`);
console.log(`Saved ${comicsPayload.comics.length} comic records to ${comicsPath}`);

async function loadSheet() {
  const response = await fetch(sourceUrl, {
    headers: { "User-Agent": "panels-hiatus-comics-sync/1.0" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Google Sheets returned ${response.status}`);
  return response.text();
}

function readPayload(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: episodesPath });
  const data = context.window.__NA_PANELI_DATA__;
  if (!data?.episodes?.length) throw new Error("Episode data is missing");
  return data;
}

function readExistingComics(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: comicsPath });
  return context.window.__NA_PANELI_COMICS__?.comics || [];
}

function buildSheetRows(header, records) {
  const rows = [];
  let proposerColumns = defaultProposerColumns();

  for (const record of records) {
    const row = Object.fromEntries(header.map((name, index) => [name, record[index] || ""]));
    const updatedColumns = proposerColumnsFromHeaderRow(row);
    if (updatedColumns) {
      proposerColumns = updatedColumns;
      continue;
    }
    if (row["Подкаст"].trim() && /^\d{2}\.\d{2}\.\d{2}$/.test(row["Публикация"].trim())) {
      rows.push({ row, proposerColumns });
    }
  }

  return rows;
}

function episodeIdentity(episode) {
  return `${episode.podcast}|${episode.number}|${episode.publication}`;
}

function extractComicEntries(row, episodeId, columns = defaultProposerColumns()) {
  const entries = [];

  for (const { column, proposer, label } of columns) {
    const raw = clean(row[column]);
    if (!raw || raw === "-") continue;
    for (const part of splitComicCell(raw)) {
      const cleaned = normalizeComicTitle(part);
      if (!cleaned.title) continue;
      entries.push({
        title: cleaned.title,
        rawTitle: part,
        kind: discussionKind(cleaned.title, part, row),
        proposer: cleaned.proposer || proposer,
        proposerColumn: label,
      });
    }
  }

  if (commonRequestEpisodeIds.has(episodeId)) {
    return entries.map((entry) => ({ ...entry, proposer: "Общая заявка" }));
  }

  return entries;
}

function defaultProposerColumns() {
  return [
    { column: "Стас", label: "Стас", proposer: "Станислав Шаргородский" },
    { column: "Леша", label: "Леша", proposer: "Алексей Замский" },
    { column: "Серега", label: "Серега", proposer: "Сергей Мангасаров" },
    { column: "Слушатели", label: "Слушатели", proposer: "Слушатели" },
  ];
}

function proposerColumnsFromHeaderRow(row) {
  const columns = defaultProposerColumns();
  const labels = columns.map(({ column }) => clean(row[column]));
  const filled = labels.filter(Boolean);
  if (!filled.length || clean(row["Подкаст"]) || clean(row["Публикация"])) return null;
  if (!filled.every(isProposerHeaderLabel)) return null;
  return columns.map(({ column }, index) => {
    const label = labels[index] || column;
    return {
      column,
      label,
      proposer: normalizeProposer(label),
    };
  });
}

function isProposerHeaderLabel(value) {
  return /^(Стас|Леша|Лёша|Никита|Серега|Серёга|Слушатели)$/i.test(clean(value));
}

function splitComicCell(value) {
  if (normalizeTitle(value) === normalizeTitle("The Wicked + The Divine")) return [value];
  return value.split(/\s+\+\s+/).map(clean).filter(Boolean);
}

function normalizeComicTitle(value) {
  const raw = clean(value);
  const proposerMatch = raw.match(/\s+\((Стас|Леша|Лёша|Никита|Серега|Серёга|Слушатели)\)$/i);
  const proposer = proposerMatch ? normalizeProposer(proposerMatch[1]) : "";
  const title = proposerMatch ? clean(raw.slice(0, proposerMatch.index)) : raw;
  return { title, proposer };
}

function applyComicCorrections(episode) {
  const titles = comicOverridesByEpisode.get(`${episode.podcast}|${episode.number}`);
  if (!titles) return episode;
  const comics = titles.map((title) => ({
    title,
    rawTitle: title,
    kind: "comic",
    proposer: "Общая заявка",
    proposerColumn: "Стас",
  }));
  return { ...episode, topics: titles, comics };
}

function normalizeProposer(value) {
  const normalized = value.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const names = {
    "стас": "Станислав Шаргородский",
    "леша": "Алексей Замский",
    "никита": "Никита Стародубцев",
    "серега": "Сергей Мангасаров",
    "слушатели": "Слушатели",
  };
  return names[normalized] || value;
}

function discussionKind(title, rawTitle, row) {
  const podcast = canonicalPodcast(clean(row["Подкаст"]));
  const comment = clean(row["Комментарий"]);
  const value = normalizeTitle(`${title} ${rawTitle} ${comment}`);
  if (podcast === "The Podcast of Zelda") return "videogame";
  if (/world seeker|odyssey|the podcast of zelda|skyward sword|minish cap|ocarina of time|link's awakening|oracle of seasons|oracle of ages|tri force heroes|echoes of wisdom|hyrule fantasy/.test(value)) {
    return "videogame";
  }
  if (/live action series|watchmen hbo|season 1|season 2/.test(value)) return "series";
  if (/baron omatsuri|strong world|stampede|film red|\\bred\\b|\\bgold\\b/.test(value)) return "movie";
  return "comic";
}

function buildComicsCatalog(episodes, existingComics = []) {
  const previousByKey = new Map(
    existingComics.map((comic) => [`${comic.kind || "comic"}|${normalizeTitle(comic.title)}`, comic]),
  );
  const byTitle = new Map();
  for (const episode of episodes) {
    for (const comic of episode.comics || []) {
      const key = `${comic.kind || "comic"}|${normalizeTitle(comic.title)}`;
      const previous = previousByKey.get(key);
      const record = byTitle.get(key) || {
        ...previous,
        id: previous?.id || slugify(comic.title),
        title: comic.title,
        kind: comic.kind || "comic",
        runTitle: previous?.runTitle || "",
        publisher: previous?.publisher || "",
        writers: previous?.writers || [],
        artists: previous?.artists || [],
        colorists: previous?.colorists || [],
        startYear: previous?.startYear || null,
        startDate: previous?.startDate || "",
        decade: previous?.decade || "",
        discussedIn: [],
        sources: previous?.sources || [
          {
            label: "Публичная таблица выпусков",
            url: sourceUrl,
          },
        ],
        status: previous?.status || "needs-review",
      };

      record.discussedIn.push({
        podcast: episode.podcast,
        number: episode.number,
        publication: episode.publication,
        episodeTitle: episode.title || "",
        proposer: comic.proposer,
        proposerColumn: comic.proposerColumn,
        rawTitle: comic.rawTitle,
        kind: comic.kind || "comic",
      });
      byTitle.set(key, record);
    }
  }

  return [...byTitle.values()].sort((left, right) => left.title.localeCompare(right.title, "ru", { sensitivity: "base" }));
}

function canonicalPodcast(podcast) {
  const names = {
    "Эксклюзив": "На бонусных панелях",
    "Пыльник": "На пыльных панелях",
    "Утешительный": "Утешительное чтение",
    "Метатекст моя отсылка": "Метатекст моя отсылка ёлы-палы лес густой",
    "На панелях. ДНК": "День новых комиксов",
  };
  return names[podcast] || podcast;
}

function correctPublication(podcast, number, publication) {
  if (podcast.toLocaleLowerCase("ru") === "на панелях" && ["93", "94"].includes(number)) {
    return publication.replace(/^2024-/, "2025-");
  }
  return publication;
}

function normalizeTitle(value) {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  const slug = value
    .toLocaleLowerCase("en")
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9а-яё]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `comic-${Math.random().toString(36).slice(2)}`;
}

function clean(value = "") {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
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
