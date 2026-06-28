import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const comicsPath = resolve(root, "data/comics.js");
const cacheDir = resolve(root, ".cache/comicvine");
const reportPath = resolve(cacheDir, "last-report.json");
const apiRoot = "https://comicvine.gamespot.com/api";
const apiKey = await loadApiKey();
const limit = Number(process.env.COMICVINE_LIMIT || 25);
const offset = Number(process.env.COMICVINE_OFFSET || 0);
const force = process.env.COMICVINE_FORCE === "1";
const retryReview = process.env.COMICVINE_RETRY_REVIEW === "1";
const onlyTitle = normalizeTitle(process.env.COMICVINE_ONLY_TITLE || "");
const onlyId = process.env.COMICVINE_ONLY_ID || "";
const volumeUrl = process.env.COMICVINE_VOLUME_URL || "";
const dryRun = process.env.COMICVINE_DRY_RUN === "1";

await mkdir(cacheDir, { recursive: true });

const payload = readPayload(await readFile(comicsPath, "utf8"));
const comics = payload.comics.map(normalizeComic);
const candidates = comics
  .map((comic, index) => ({ comic, index }))
  .filter(({ comic }) => !onlyId || comic.id === onlyId)
  .filter(({ comic }) => !onlyTitle || normalizeTitle(comic.title) === onlyTitle)
  .filter(({ comic }) => force || shouldEnrich(comic))
  .slice(offset, offset + limit);
const report = {
  createdAt: new Date().toISOString(),
  limit,
  offset,
  processed: 0,
  updated: 0,
  skipped: comics.length - candidates.length,
  errors: [],
};

for (const { comic, index } of candidates) {
  report.processed += 1;
  try {
    const result = await enrichComic(comic);
    if (!result) continue;
    comics[index] = result;
    report.updated += 1;
    await sleep(250);
  } catch (error) {
    report.errors.push({ title: comic.title, message: error.message });
    if (/rate limit|returned 420/i.test(error.message)) break;
  }
}

if (!dryRun) {
  const updatedPayload = {
    ...payload,
    enrichedAt: new Date().toISOString().slice(0, 10),
    comics: comics.map(stripRuntimeFields),
  };
  await writeFile(comicsPath, `window.__NA_PANELI_COMICS__ = ${JSON.stringify(updatedPayload, null, 2)};\n`, "utf8");
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Processed ${report.processed} comics, updated ${report.updated}. Report: ${reportPath}`);
if (report.errors.length) {
  console.log(`Errors: ${report.errors.slice(0, 8).map((error) => `${error.title}: ${error.message}`).join(" | ")}`);
}

async function enrichComic(comic) {
  const volume = volumeUrl
    ? {
        api_detail_url: `https://comicvine.gamespot.com/api/volume/${idFromUrl(volumeUrl)}/`,
        site_detail_url: volumeUrl,
      }
    : pickBestVolume(comic.title, await searchVolumes(comic.title));
  if (!volume) return markReview(comic, "comicvine-no-match");

  const details = await getVolume(volume.api_detail_url);
  const firstIssue = details.first_issue?.api_detail_url ? await getIssue(details.first_issue.api_detail_url) : null;
  const volumeCredits = splitCredits(details.person_credits || []);
  const issueCredits = splitCredits(firstIssue?.person_credits || []);
  const startYear = Number(details.start_year) || yearFromDate(firstIssue?.store_date || firstIssue?.cover_date);
  const startDate = firstIssue?.store_date || firstIssue?.cover_date || "";
  const next = {
    ...comic,
    publisher: details.publisher?.name || volume.publisher?.name || comic.publisher,
    writers: mergeValues(comic.writers, issueCredits.writers.length ? issueCredits.writers : volumeCredits.writers),
    artists: mergeValues(comic.artists, issueCredits.artists.length ? issueCredits.artists : volumeCredits.artists),
    colorists: mergeValues(comic.colorists, issueCredits.colorists.length ? issueCredits.colorists : volumeCredits.colorists),
    startYear: comic.startYear || startYear || null,
    startDate: comic.startDate || startDate,
    decade: comic.decade || decadeFromYear(startYear),
    runTitle: comic.runTitle || details.name || volume.name,
    sources: mergeSources(comic.sources, [
      {
        label: "Comic Vine",
        url: details.site_detail_url || volume.site_detail_url,
      },
    ]),
  };
  next.status = next.publisher && hasCredits(next) ? "verified" : "needs-review";
  if (next.status === "verified") delete next.reviewNote;
  else if (!hasCredits(next)) next.reviewNote = "comicvine-credits-not-found";
  return next;
}

async function searchVolumes(title) {
  return comicVineJson(`search-${cacheKey(title)}.json`, "/search/", {
    query: title,
    resources: "volume",
    field_list: "id,name,start_year,publisher,api_detail_url,site_detail_url,count_of_issues",
    limit: "10",
  }).then((json) => json.results || []);
}

async function getVolume(apiDetailUrl) {
  return comicVineJson(`volume-${idFromUrl(apiDetailUrl)}.json`, apiDetailUrl, {
    field_list: "id,name,start_year,publisher,first_issue,person_credits,api_detail_url,site_detail_url,count_of_issues",
  }).then((json) => json.results || {});
}

async function getIssue(apiDetailUrl) {
  return comicVineJson(`issue-${idFromUrl(apiDetailUrl)}.json`, apiDetailUrl, {
    field_list: "id,name,issue_number,store_date,cover_date,person_credits,api_detail_url,site_detail_url",
  }).then((json) => json.results || {});
}

async function comicVineJson(cacheName, pathOrUrl, params) {
  const path = resolve(cacheDir, cacheName);
  if (!force) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {}
  }
  const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${apiRoot}${pathOrUrl}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "panels-hiatus-comicvine/1.0",
    },
  });
  const text = await response.text();
  await writeFile(path, text, "utf8");
  if (response.status === 420 || response.status === 429) throw new Error(`Comic Vine rate limit (${response.status})`);
  if (!response.ok) throw new Error(`Comic Vine returned ${response.status}`);
  const json = JSON.parse(text);
  if (json.status_code !== 1) throw new Error(json.error || `Comic Vine status ${json.status_code}`);
  return json;
}

function pickBestVolume(title, results) {
  const wanted = normalizeTitle(title);
  const exact = results.find((result) => normalizeTitle(result.name) === wanted);
  if (exact) return exact;
  const starts = results.find((result) => normalizeTitle(result.name).startsWith(wanted) || wanted.startsWith(normalizeTitle(result.name)));
  if (starts) return starts;
  return results.find((result) => tokenScore(wanted, normalizeTitle(result.name)) >= 0.72) || null;
}

function splitCredits(credits) {
  const result = { writers: [], artists: [], colorists: [] };
  for (const credit of credits) {
    const role = normalizeTitle(credit.role || "");
    if (/\b(writer|story|script|creator)\b/.test(role)) result.writers.push(credit.name);
    if (/\b(artist|penciler|penciller|inker|illustrator)\b/.test(role)) result.artists.push(credit.name);
    if (/\b(colorist|colourist|colors|colours)\b/.test(role)) result.colorists.push(credit.name);
  }
  return {
    writers: uniqueClean(result.writers),
    artists: uniqueClean(result.artists),
    colorists: uniqueClean(result.colorists),
  };
}

async function loadApiKey() {
  const direct = process.env.COMICVINE_API_KEY?.trim();
  if (direct) return direct;
  const file = process.env.COMICVINE_API_KEY_FILE || ".secrets/comicvine-api-key.txt";
  const key = (await readFile(resolve(root, file), "utf8")).trim();
  if (!key) throw new Error("Comic Vine API key is empty");
  return key;
}

function hasCredits(comic) {
  return Boolean(comic.writers?.length || comic.artists?.length || comic.colorists?.length);
}

function shouldEnrich(comic) {
  if (retryReview) return comic.status !== "verified";
  if (comic.reviewNote?.startsWith("comicvine-")) return false;
  return comic.status !== "verified" || !comic.publisher || !hasCredits(comic);
}

function markReview(comic, note) {
  return { ...comic, reviewNote: note, status: "needs-review" };
}

function mergeValues(current = [], incoming = []) {
  return uniqueClean([...current, ...incoming]);
}

function mergeSources(current = [], incoming = []) {
  const byUrl = new Map();
  for (const source of [...current, ...incoming]) {
    if (source?.url) byUrl.set(source.url, source);
  }
  return [...byUrl.values()];
}

function uniqueClean(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => String(item || "").trim()).filter(Boolean)) {
    const key = normalizeTitle(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function normalizeComic(comic) {
  return {
    ...comic,
    writers: comic.writers || [],
    artists: comic.artists || [],
    colorists: comic.colorists || [],
    sources: comic.sources || [],
  };
}

function stripRuntimeFields(comic) {
  return comic;
}

function readPayload(source) {
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: comicsPath });
  const data = context.window.__NA_PANELI_COMICS__;
  if (!data?.comics?.length) throw new Error("Comic data is missing");
  return data;
}

function idFromUrl(url) {
  return String(url).replace(/\/$/, "").split("/").pop() || cacheKey(url);
}

function yearFromDate(date) {
  const year = Number(String(date || "").slice(0, 4));
  return year || null;
}

function decadeFromYear(year) {
  return year ? `${Math.floor(year / 10) * 10}-е` : "";
}

function tokenScore(wanted, found) {
  const want = new Set(wanted.split(/\s+/).filter(Boolean));
  const got = new Set(found.split(/\s+/).filter(Boolean));
  if (!want.size) return 0;
  let hits = 0;
  for (const token of want) if (got.has(token)) hits += 1;
  return hits / want.size;
}

function normalizeTitle(value) {
  return String(value)
    .toLocaleLowerCase("en")
    .replaceAll("&", "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(value) {
  return normalizeTitle(value).replace(/\s+/g, "-").slice(0, 90) || "empty";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
