import sheetLinks from "./data/episode-links.js";
// Both views share links; Boosty is preferred everywhere since spidermedia.ru went offline.
export function createEpisodeLinkResolver(episodes, comics) {
  const links = new Map();
  const key = (episode) => episode.number
    ? `${episode.podcast}|${episode.number}`
    : `${episode.podcast}|${episode.publication}|${episode.title || episode.episodeTitle || ""}`;
  const valid = (value) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return url.hostname.replace(/^www\./, "") === "spidermedia.ru" ? null : url;
    } catch { return null; }
  };
  const records = [...episodes, ...comics.flatMap((comic) => comic.discussedIn || [])];
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
    return candidates.find((link) => valid(link).hostname === "boosty.to")
      || candidates[0] || "";
  };
}
