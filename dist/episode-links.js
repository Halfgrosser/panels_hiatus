import sheetLinks from "./data/episode-links.js";
// Both views share links, including curated Spidermedia URLs in the catalog.
export function createEpisodeLinkResolver(episodes, comics) {
  const links = new Map();
  const key = (episode) => episode.number
    ? `${episode.podcast}|${episode.number}`
    : `${episode.podcast}|${episode.publication}|${episode.title || episode.episodeTitle || ""}`;
  const valid = (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url : null;
    } catch { return null; }
  };
  const records = [...episodes, ...comics.flatMap((comic) => comic.discussedIn || [])];
  const metadata = new Map(episodes.map((episode) => [key(episode), episode]));
  for (const episode of records) {
    if (!valid(episode.link)) continue;
    const id = key(episode);
    const values = links.get(id) || [];
    values.push(episode.link);
    links.set(id, values);
  }
  return (episode) => {
    if (valid(sheetLinks[key(episode)])) return sheetLinks[key(episode)];
    const candidates = links.get(key(episode)) || [];
    const patron = (metadata.get(key(episode)) || episode).supportersOnly || ["ASOP", "На бонусных панелях", "Утешительное чтение"].includes(episode.podcast);
    const preferred = patron ? "boosty.to" : "spidermedia.ru";
    return candidates.find((link) => valid(link).hostname.replace(/^www\./, "") === preferred)
      || candidates.find((link) => valid(link).hostname === "boosty.to")
      || candidates[0] || "";
  };
}
