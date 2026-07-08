import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = "1xlG146EJ3go3MDKndnvd5OVVWj8adZmKCKaWjn3FF3Y";
const SHEET_GID = "0";
const sourceUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const rssUrl = process.env.BOOSTY_RSS_URL;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const episodesOutput = resolve(root, "data/episodes.js");
const comicsOutput = resolve(root, "data/comics.js");
const patreonRecords = [
  {
    podcast: "На ночь глядя",
    publication: "2018-11-15",
    title: "«На ночь глядя»: Майринк и печник",
    link: "https://www.patreon.com/spidermedia/posts/na-noch-gliadia-22719877",
  },
  {
    podcast: "На ночь глядя",
    publication: "2019-01-11",
    title: "«На ночь глядя»: Моррисон и сон",
    link: "https://www.patreon.com/spidermedia/posts/na-noch-gliadia-23897337",
  },
  {
    podcast: "На ночь глядя",
    publication: "2019-03-13",
    title: "«На ночь глядя»: домашний стиль Айн Рэнд",
    link: "https://www.patreon.com/spidermedia/posts/na-noch-gliadia-25333149",
  },
  {
    podcast: "На ночь глядя",
    publication: "2019-08-09",
    title: "«На ночь глядя»: вы не поверите, кто здесь",
    link: "https://www.patreon.com/spidermedia/posts/na-noch-gliadia-29027183",
  },
  {
    podcast: "Прочие спецвыпуски",
    publication: "2019-10-18",
    title: 'CCR special - "средь шумного кона случайно"',
    link: "https://www.patreon.com/spidermedia/posts/ccr-special-sred-30845082",
  },
  {
    podcast: "Gol D. Panels",
    number: "OP02",
    publication: "2021-05-31",
    title: "Gol D. Panels. Saga 02: Alabasta",
    link: "",
  },
  {
    podcast: "Прочие спецвыпуски",
    publication: "2019-10-20",
    title: "«На (звуковых) полях»: Разговор с русским переводчиком «Провиденс» Алексеем Мальским",
    link: "https://www.patreon.com/spidermedia/posts/na-zvukovykh-s-30905710",
  },
  {
    publication: "2021-02-04",
    title: "Прочёл, пришел и рассказал: John Lewis's March Trilogy",
    link: "https://www.patreon.com/spidermedia/posts/prochiol-prishel-47121718",
  },
  {
    publication: "2021-03-28",
    title: "Прочёл, пришёл и рассказал: Vault Comics Nightfall",
    link: "https://www.patreon.com/spidermedia/posts/prochiol-i-vault-49203971",
  },
  {
    publication: "2021-09-18",
    title: "Прочёл, пришёл и рассказал: четыре проходных для меня комикса и кино про червячков",
    link: "https://www.patreon.com/spidermedia/posts/prochiol-i-dlia-56304143",
  },
  {
    podcast: "Прочие спецвыпуски",
    publication: "2022-03-31",
    title: "SPIDER Talk: Потерянный эпизод",
    link: "https://www.patreon.com/spidermedia/posts/spider-talk-64508681",
  },
  {
    publication: "2022-02-07",
    title: "Прочёл, пришёл и рассказал: R-rated comics (not really)",
    link: "https://www.patreon.com/spidermedia/posts/prochiol-i-r-not-62210259",
  },
  {
    publication: "2022-11-09",
    title: "Прочёл, пришел и рассказал: Deadly Class & Friday",
    link: "https://www.patreon.com/spidermedia/posts/prochiol-prishel-74438931",
  },
  {
    podcast: "Прочие спецвыпуски",
    publication: "2022-08-17",
    title: "SPIDER Talk: Потерянный эпизод #2",
    link: "https://www.patreon.com/spidermedia/posts/spider-talk-2-70642686",
  },
  {
    podcast: "The Podcast of Zelda",
    number: "1",
    publication: "2022-11-05",
    title: "The Podcast of Zelda #01: Skyward Sword // The Minish Cap",
    link: "https://www.patreon.com/spidermedia/posts/podcast-of-zelda-74262434",
  },
  {
    podcast: "Прочие спецвыпуски",
    publication: "2022-12-24",
    title: "SILVERS Talk: Пятнашки, Бейсбол и Рыбалка",
    link: "https://www.patreon.com/spidermedia/posts/silvers-talk-i-76326891",
  },
];

const excludedEpisodes = new Set([
  "Gol D. Panels|OP2",
  "Gol D. Panels|-",
  "На пыльных панелях|D13",
]);

const excludedTitles = new Set(
  [
    'CCR special - "средь шумного кона случайно"',
    "X-Club 22.1. Generation X",
    'Бонусная часть к "Зельде": Миссис Мэйзел, Demon Slayer, Final Fantasy и Super Mario Bros.',
  ].map(normalizeTitle),
);

const otherSpecialTitles = new Set(
  [
    "«На (звуковых) полях»: Разговор с русским переводчиком «Провиденс» Алексеем Мальским",
    "SPIDER Talk: Потерянный эпизод",
    "SPIDER Talk: Потерянный эпизод #2",
    "SILVERS Talk: Пятнашки, Бейсбол и Рыбалка",
    "Бонусная часть без утешительного чтения: январский спецвыпуск",
    "Бонусная часть к утешительному чтению: Анимация 2022, часть первая",
    "Бонусная часть к утешительному чтению: Анимация 2022, часть вторая",
    "Бонусная часть к утешительному чтению: Анимация 2022, часть третья",
    "Подкаст кинокомиксов",
    "«На (звуковых) полях»: Разговор с художником Agent of W.O.R.L.D.E. Филей Братухиным",
    "Тула LIVE: Embrace Your Inner Fanperson на примере One Piece Fan Letter",
    "Тула LIVE: Метатекст моя отсылка елы-палы лес густой",
  ].map(normalizeTitle),
);

const publicationOverridesByEpisode = new Map([
  ["На панелях|55", "2020-07-15"],
  ["На пыльных панелях|D1", "2020-07-08"],
  ["X of Panels|XoP9", "2020-11-24"],
  ["На бонусных панелях|E1", "2020-02-13"],
  ["Утешительное чтение|LR13", "2022-07-05"],
  ["Утешительное чтение|LR21", "2022-10-27"],
  ["Утешительное чтение|LR25", "2023-02-11"],
  ["ASOP|M0", "2021-10-21"],
  ["ASOP|M7", "2023-02-07"],
  ["ASOP|M16", "2025-07-03"],
  ["ASOP|M17", "2026-04-12"],
  ["ASOP|M18", "2026-07-08"],
]);

const publicationOverridesByTitle = new Map(
  [
    ["X-Club 04. The Dark Phoenix", "2024-05-26"],
    ["X-Club 07. Graduation Day", "2024-06-11"],
    ["X-Club 19. Secondary Mutation", "2024-08-13"],
    ["X-Club 20. Deadpool & Wolverine", "2024-08-15"],
    ["Avatar Club. Book 01: Water", "2026-04-29"],
    ["Прочёл, пришел и рассказал: Amazing Spider-Man & Human Target", "2023-06-20"],
    ["ХОДИЛ СМОТРЕТЬ НА РАЗДАВЛЕННЫЕ ПОМИДОРЫ", "2023-09-13"],
    ["Прочёл, пришел и рассказал: Eternals & Green Hell", "2023-11-16"],
    ["Прочёл, пришел и рассказал: МНОГО КОМИКСОВ", "2024-02-09"],
    ["Прочёл, пришёл и рассказал: ошибка в ДНК", "2026-06-18"],
    ["Метатекст моя отсылка ёлы-палы лес густой, часть 1: Вальдшнепы", "2025-05-06"],
    ["Метатекст моя отсылка ёлы-палы лес густой, часть 3: пост пост", "2025-06-28"],
    ["Метатекст моя отсылка ёлы-палы лес густой, часть 4: проблема", "2025-07-16"],
    ["Метатекст моя отсылка ёлы-палы лес густой, часть 5: не специалист", "2025-07-30"],
    ["Метатекст моя отсылка ёлы-палы лес густой, часть 6: пока идет футбол", "2026-06-18"],
    ["Подкаст кинокомиксов", "2023-11-24"],
    ["Тула LIVE: Метатекст моя отсылка елы-палы лес густой", "2025-04-14"],
  ].map(([title, publication]) => [normalizeTitle(title), publication]),
);
const commonRequestEpisodeIds = new Set([
  14, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 53, 54, 55, 58, 59, 60, 62, 63, 66, 67, 70, 75, 78, 79, 80,
  81, 82, 83, 84, 85, 86, 87, 88, 96, 100, 103, 104, 105, 106, 107, 108, 109, 110, 112, 113, 114, 115, 116,
  118, 119, 120, 121, 123, 124, 125, 126, 127, 129, 130, 132, 136, 154, 157, 158, 161, 162, 165, 168, 172, 173,
  174, 175, 178, 181, 182, 183, 184, 186, 190, 192, 194, 195, 196, 197, 198, 200, 203, 204, 209, 212, 213, 215,
  219, 223, 224, 225, 226, 228, 230, 231,
]);

if (!rssUrl && !process.env.SYNC_RSS_FILE) {
  throw new Error("Set BOOSTY_RSS_URL or SYNC_RSS_FILE to load the RSS feed");
}

const [csv, rss] = await Promise.all([
  loadSource(sourceUrl, "Google Sheets", process.env.SYNC_SHEET_FILE),
  loadSource(rssUrl, "Boosty RSS", process.env.SYNC_RSS_FILE),
]);
const [header, ...records] = parseCsv(csv);
const rows = buildSheetRows(header, records);

const sheetEpisodes = rows
  .map(({ row, proposerColumns }) => {
    const id = Number(row[""]) || null;
    const comics = extractComicEntries(row, id, proposerColumns);
    return {
      id,
      podcast: canonicalPodcast(clean(row["Подкаст"])),
      number: clean(row["#"]),
      publication: correctPublication(clean(row["Подкаст"]), clean(row["#"]), toIsoDate(row["Публикация"])),
      topics: comics.map((comic) => comic.title),
      comics,
      participants: clean(row["Участники"]),
      comment: clean(row["Комментарий"]),
      supportersOnly: isMarked(row["Доступно только\nна Patreon / Boosty"]),
      supportersFree: isMarked(row["В свободном доступе\nна Patreon / Boosty"]),
      source: "google-sheet",
    };
  });

const rssItems = parseRss(rss).filter((item) => !isRawRecording(item.title));
const enrichedSheetEpisodes = sheetEpisodes.map((episode) => mergeRssMetadata(episode, rssItems));
const rssEpisodes = rssItems
  .filter((item) => !isRepresentedInSheet(item, enrichedSheetEpisodes))
  .map(toRssEpisode);
const importedEpisodes = [...enrichedSheetEpisodes, ...rssEpisodes].map(applyCorrections).filter(shouldIncludeEpisode);
const patreonEpisodes = patreonRecords
  .map(toPatreonEpisode)
  .map(applyCorrections)
  .filter(shouldIncludeEpisode)
  .filter((manual) => !importedEpisodes.some((episode) => episode.title && sameTitle(episode.title, manual.title)));

const episodes = [...importedEpisodes, ...patreonEpisodes].sort(
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
const comicsPayload = {
  source: sourceUrl,
  updatedAt: payload.updatedAt,
  comics: buildComicsCatalog(episodes),
};

await mkdir(dirname(episodesOutput), { recursive: true });
await writeFile(episodesOutput, `window.__NA_PANELI_DATA__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
await writeFile(comicsOutput, `window.__NA_PANELI_COMICS__ = ${JSON.stringify(comicsPayload, null, 2)};\n`, "utf8");
console.log(
  `Saved ${episodes.length} episodes (${sheetEpisodes.length} from the sheet, ${rssEpisodes.length} RSS-only, ${patreonEpisodes.length} Patreon-only) to ${episodesOutput}`,
);
console.log(`Saved ${comicsPayload.comics.length} comic records to ${comicsOutput}`);

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

function mergeRssMetadata(episode, rssItems) {
  const item = rssItems.find((candidate) => {
    const identity = titleIdentity(candidate.title);
    if (!identity) return false;
    return (
      episode.podcast.toLocaleLowerCase("ru") === identity.podcast.toLocaleLowerCase("ru") &&
      episode.number.toLocaleLowerCase("ru") === identity.number.toLocaleLowerCase("ru")
    );
  });
  if (!item) return episode;
  return {
    ...episode,
    title: item.title,
    link: item.link,
    guid: item.guid,
  };
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

function buildComicsCatalog(episodes) {
  const byTitle = new Map();
  for (const episode of episodes) {
    for (const comic of episode.comics || []) {
      const key = `${comic.kind || "comic"}|${normalizeTitle(comic.title)}`;
      const record = byTitle.get(key) || {
        id: slugify(comic.title),
        title: comic.title,
        kind: comic.kind || "comic",
        runTitle: "",
        publisher: "",
        writers: [],
        artists: [],
        colorists: [],
        startYear: null,
        startDate: "",
        decade: "",
        discussedIn: [],
        sources: [
          {
            label: "Публичная таблица выпусков",
            url: sourceUrl,
          },
        ],
        status: "needs-review",
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

function slugify(value) {
  const slug = value
    .toLocaleLowerCase("en")
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9а-яё]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `comic-${Math.random().toString(36).slice(2)}`;
}

function titleIdentity(title) {
  const patterns = [
    [/^«На панелях»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "На панелях", number })],
    [/^«На пыльных панелях»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "На пыльных панелях", number: `D${number}` })],
    [/^«На панелях\. Лайт»\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "Лайт", number: `L${number}` })],
    [/^Amazing Screw-On Podcast\s*#0*(\d+)/i, (number) => ({ podcast: "ASOP", number: `M${number}` })],
    [/^Amazing Screw-On Club\s*#0*(\d+)/i, (number) => ({ podcast: "Amazing Screw-On Club", number: `ASC${number}` })],
    [/^Утешительное чтение\. Выпуск\s*0*(\d+)/i, (number) => ({ podcast: "Утешительное чтение", number: `LR${number}` })],
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
  const episode = {
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

  if (item.title === "Посмотрел, пришел и рассказал: Snyder Cut") {
    return {
      ...episode,
      podcast: "Прочёл, пришёл и рассказал",
      publication: "2021-03-23",
      link: "https://www.patreon.com/spidermedia/posts/posmotrel-i-cut-49111867",
    };
  }

  return episode;
}

function toPatreonEpisode(record) {
  return {
    id: null,
    podcast: record.podcast || "Прочёл, пришёл и рассказал",
    number: record.number || "",
    publication: record.publication,
    title: record.title,
    topics: [],
    participants: "",
    comment: "",
    supportersOnly: true,
    supportersFree: false,
    source: "patreon",
    link: record.link,
    guid: "",
  };
}

function applyCorrections(episode) {
  const titleKey = normalizeTitle(episode.title || "");
  let podcast = canonicalPodcast(episode.podcast);
  const publication = publicationOverridesByTitle.get(titleKey) ||
    publicationOverridesByEpisode.get(`${podcast}|${episode.number}`) ||
    episode.publication;

  if (titleKey === normalizeTitle("ХОДИЛ СМОТРЕТЬ НА РАЗДАВЛЕННЫЕ ПОМИДОРЫ")) {
    podcast = "Прочёл, пришёл и рассказал";
  } else if (otherSpecialTitles.has(titleKey)) {
    podcast = "Прочие спецвыпуски";
  }

  return { ...episode, podcast, publication };
}

function shouldIncludeEpisode(episode) {
  if (
    episode.podcast === "Gol D. Panels" &&
    episode.number === "OP02" &&
    normalizeTitle(episode.title || "") === normalizeTitle("Gol D. Panels. Saga 02: Alabasta")
  ) {
    return true;
  }
  if (excludedEpisodes.has(`${episode.podcast}|${episode.number}`)) return false;
  if (episode.podcast === "Amazing Screw-On Club") return false;
  return !excludedTitles.has(normalizeTitle(episode.title || ""));
}

function sameTitle(left, right) {
  return normalizeTitle(left) === normalizeTitle(right);
}

function normalizeTitle(value) {
  return value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
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

function inferRssFormat(title) {
  const formats = [
    [/^«На панелях\. ДНК»/i, "День новых комиксов", ""],
    [/^X-Club\s+(\d+(?:\.\d+)?)(?:\.|\s|$)/i, "X-Club"],
    [/^The Podcast of Zelda\s*#0*(\d+)/i, "The Podcast of Zelda"],
    [/^Avatar Club\. Book\s*0*(\d+)/i, "Avatar Club"],
    [/^Письма от слушателей\. Выпуск\s*0*(\d+)/i, "Письма от слушателей"],
    [/^Проч[её]л, приш[её]л и рассказал/i, "Прочёл, пришёл и рассказал", ""],
    [/^Посмотрел, приш[её]л и рассказал/i, "Прочёл, пришёл и рассказал", ""],
    [/^Метатекст моя отсылка/i, "Метатекст моя отсылка ёлы-палы лес густой", ""],
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

function correctPublication(podcast, number, publication) {
  if (podcast.toLocaleLowerCase("ru") === "на панелях" && ["93", "94"].includes(number)) {
    return publication.replace(/^2024-/, "2025-");
  }
  return publication;
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
