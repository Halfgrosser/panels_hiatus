import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const comicsPath = resolve(root, "data/comics.js");
const cacheDir = resolve(root, ".cache/locg");
const reportPath = resolve(cacheDir, "last-report.json");
const rootUrl = "https://leagueofcomicgeeks.com";
const searchEndpoint = `${rootUrl}/comic/get_comics`;
const limit = Number(process.env.LOCG_LIMIT || 25);
const offset = Number(process.env.LOCG_OFFSET || 0);
const force = process.env.LOCG_FORCE === "1";
const dryRun = process.env.LOCG_DRY_RUN === "1";
const cookieHeader = await loadCookieHeader(process.env.LOCG_COOKIE_FILE);

await mkdir(cacheDir, { recursive: true });

const payload = readPayload(await readFile(comicsPath, "utf8"));
const comics = payload.comics.map(normalizeComic);
const candidates = comics
  .map((comic, index) => ({ comic, index }))
  .filter(({ comic }) => force || comic.status !== "verified" || !comic.publisher || !hasCredits(comic))
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
    await sleep(450);
  } catch (error) {
    report.errors.push({ title: comic.title, message: error.cause?.message || error.message });
    if (/cloudflare|403|just a moment/i.test(error.message)) break;
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
  console.log(`Errors: ${report.errors.map((error) => `${error.title}: ${error.message}`).join(" | ")}`);
}

async function enrichComic(comic) {
  const search = await searchSeries(comic.title);
  const match = pickBestSeries(comic.title, search);
  if (!match) return markReview(comic, "locg-no-match");

  const page = await fetchCached(`series-${match.id}.html`, match.url);
  const credits = extractCredits(page);
  const next = {
    ...comic,
    publisher: match.publisher || comic.publisher,
    writers: mergeValues(comic.writers, credits.writers),
    artists: mergeValues(comic.artists, credits.artists),
    colorists: mergeValues(comic.colorists, credits.colorists),
    runTitle: comic.runTitle || match.name,
    sources: mergeSources(comic.sources, [
      {
        label: "League of Comic Geeks",
        url: match.url,
      },
    ]),
  };

  next.status = next.publisher && hasCredits(next) ? "verified" : "needs-review";
  if (!hasCredits(next)) next.reviewNote = "locg-credits-not-found";
  return next;
}

async function searchSeries(title) {
  const params = new URLSearchParams({
    list: "search",
    list_option: "series",
    view: "thumbs",
    order: "alpha-asc",
    title,
  });
  const text = await fetchCached(`search-${cacheKey(title)}.json`, `${searchEndpoint}?${params}`);
  let responseJson;
  try {
    responseJson = JSON.parse(text);
  } catch {
    if (/just a moment|cloudflare/i.test(text)) throw new Error("League of Comic Geeks Cloudflare challenge");
    throw new Error("Unable to parse League search response");
  }
  if (!responseJson || typeof responseJson.list !== "string") return [];
  return parseSeriesList(responseJson.list);
}

async function fetchCached(name, url) {
  const path = resolve(cacheDir, name);
  if (!force) {
    try {
      return await readFile(path, "utf8");
    } catch {}
  }
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(cookieHeader ? { "cookie": cookieHeader } : {}),
      "user-agent": "Mozilla/5.0 panels-hiatus/1.0",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  const text = await response.text();
  await writeFile(path, text, "utf8");
  if (!response.ok) {
    if (/just a moment|cloudflare/i.test(text)) throw new Error(`League of Comic Geeks Cloudflare challenge (${response.status})`);
    throw new Error(`League of Comic Geeks returned ${response.status}`);
  }
  return text;
}

function parseSeriesList(html) {
  const items = html.match(/<li[\s\S]*?<\/li>/gi) || [];
  return items
    .map((item) => {
      const linkMatch = item.match(/<a[^>]+data-id="([^"]+)"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const publisherMatch = item.match(/class="[^"]*publisher[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      const detailsMatch = item.match(/class="[^"]*details[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      if (!linkMatch) return null;
      const [, id, href, nameHtml] = linkMatch;
      return {
        id,
        name: cleanHtml(nameHtml),
        url: absoluteUrl(href),
        publisher: publisherMatch ? cleanHtml(publisherMatch[1]) : "",
        count: detailsMatch ? Number.parseInt(cleanHtml(detailsMatch[1]), 10) || null : null,
      };
    })
    .filter(Boolean);
}

function pickBestSeries(title, results) {
  const wanted = normalizeTitle(title);
  const exact = results.find((result) => normalizeTitle(result.name) === wanted);
  if (exact) return exact;
  const starts = results.find((result) => normalizeTitle(result.name).startsWith(wanted));
  if (starts) return starts;
  return results.find((result) => tokenScore(wanted, normalizeTitle(result.name)) >= 0.72) || null;
}

function extractCredits(html) {
  const sections = {
    writers: [/writer/i, /story/i],
    artists: [/artist/i, /penciller/i, /inker/i, /illustrator/i],
    colorists: [/colorist/i, /colourist/i, /colors/i, /colours/i],
  };
  const credits = { writers: [], artists: [], colorists: [] };

  for (const [field, labels] of Object.entries(sections)) {
    for (const label of labels) {
      const pattern = new RegExp(`<[^>]*(?:class|data[^=]*)="[^"]*(?:${label.source})[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi");
      for (const match of html.matchAll(pattern)) {
        credits[field].push(...extractNames(match[1]));
      }
    }
  }

  const text = cleanHtml(html);
  for (const [field, labels] of Object.entries(sections)) {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label.source}s?\\s*:?\\s*([^•|]+?)(?:\\s{2,}|Publisher|Writer|Artist|Colorist|$)`, "i"));
      if (match) credits[field].push(...splitNames(match[1]));
    }
  }

  return {
    writers: uniqueClean(credits.writers),
    artists: uniqueClean(credits.artists),
    colorists: uniqueClean(credits.colorists),
  };
}

function extractNames(fragment) {
  const linked = [...fragment.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map(([, value]) => cleanHtml(value));
  return linked.length ? linked : splitNames(cleanHtml(fragment));
}

function splitNames(value) {
  return value
    .split(/,|·|\/|\band\b/gi)
    .map((item) => item.trim())
    .filter((item) => item && item.length < 80 && !/^(writer|artist|colorist|publisher)$/i.test(item));
}

function hasCredits(comic) {
  return Boolean(comic.writers?.length || comic.artists?.length || comic.colorists?.length);
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
  for (const value of values.map((item) => cleanHtml(item)).filter(Boolean)) {
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

async function loadCookieHeader(cookiePath) {
  if (!cookiePath) return "";
  const source = await readFile(resolve(root, cookiePath), "utf8");
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return jsonCookiesToHeader(trimmed);
  return netscapeCookiesToHeader(source);
}

function jsonCookiesToHeader(source) {
  const parsed = JSON.parse(source);
  const cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
  return cookies
    .filter((cookie) => cookie?.name && typeof cookie.value !== "undefined" && isLeagueCookieDomain(cookie.domain || ""))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function netscapeCookiesToHeader(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
    .map((line) => line.replace(/^#HttpOnly_/, "").split("\t"))
    .filter((parts) => parts.length >= 7 && isLeagueCookieDomain(parts[0]))
    .map((parts) => `${parts[5]}=${parts.slice(6).join("\t")}`)
    .join("; ");
}

function isLeagueCookieDomain(domain) {
  const normalized = String(domain).replace(/^#HttpOnly_/, "").replace(/^\./, "").toLowerCase();
  return normalized === "leagueofcomicgeeks.com" || normalized.endsWith(".leagueofcomicgeeks.com");
}

function absoluteUrl(href) {
  if (!href) return "";
  return href.startsWith("http") ? href : `${rootUrl}${href.startsWith("/") ? "" : "/"}${href}`;
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

function cleanHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
