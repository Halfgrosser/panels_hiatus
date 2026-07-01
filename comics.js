const data = window.__NA_PANELI_COMICS__;

const search = document.querySelector("#comic-search");
const proposerFilter = document.querySelector("#proposer-filter");
const publisherFilter = document.querySelector("#publisher-filter");
const decadeFilter = document.querySelector("#decade-filter");
const podcastFilter = document.querySelector("#podcast-filter");
const controlsPanel = document.querySelector(".comics-controls");
const activeFilters = document.querySelector("#active-comic-filters");
const comicList = document.querySelector("#comic-list");
const scrollSearchButton = document.querySelector(".scroll-search-button");
const ruDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const formatNames = {
  all: "Все форматы",
};
const formatGroups = new Map([
  ["Panels of X", new Set(["Panels of X", "X of Panels", "Hellfire Panels", "Inferno Panels"])],
]);
const proposerOrder = [
  "Алексей Замский",
  "Станислав Шаргородский",
  "Сергей Мангасаров",
  "Никита Стародубцев",
  "Слушатели",
  "Общая заявка",
];
const formatOrder = ["На панелях"];
const criterionLabels = {
  publisher: "Издательство",
  writers: "Сценарист",
  artists: "Художник",
  colorists: "Колорист",
};
const activeCriteria = {
  publisher: new Map(),
  writers: new Map(),
  artists: new Map(),
  colorists: new Map(),
};

if (!data?.comics?.length) {
  comicList.innerHTML = '<p class="error">Не удалось загрузить каталог комиксов. Запустите <code>npm run sync:comics</code>.</p>';
  throw new Error("Comic data is missing");
}

const comics = data.comics.map(normalizeComicRecord);
const comicRows = comics
  .flatMap((comic) => (comic.discussedIn || []).map((episode) => ({ comic, episode })))
  .filter(({ comic, episode }) => (episode.kind || comic.kind || "comic") === "comic");
const allProposers = sortProposers(comicRows.map(({ episode }) => episode.proposer || "Общая заявка"));
const allPublishers = sortedUnique(comicRows.map(({ comic }) => comic.publisher || "На проверке"));
const allDecades = sortedUnique(comicRows.map(({ comic }) => comic.decade || decadeFromYear(comic.startYear) || "На проверке"));
const allPodcasts = sortedUnique(comicRows.map(({ episode }) => filterFormat(episode))).sort(compareFormats);

proposerFilter.innerHTML = toOptions(["Все заявители", ...allProposers]);
publisherFilter.innerHTML = toOptions(["Все издательства", ...allPublishers]);
decadeFilter.innerHTML = toOptions(["Все десятилетия", ...allDecades]);
podcastFilter.innerHTML = toOptions(["Все форматы", ...allPodcasts], formatNames);

for (const control of [search, proposerFilter, publisherFilter, decadeFilter, podcastFilter]) {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
}
comicList.addEventListener("click", handleCriterionClick);
activeFilters.addEventListener("click", handleCriterionRemove);
scrollSearchButton?.addEventListener("click", () => {
  const top = controlsPanel.getBoundingClientRect().top + window.scrollY - 18;
  window.scrollTo({ top, behavior: "smooth" });
  window.setTimeout(() => search.focus({ preventScroll: true }), 250);
});
window.addEventListener("scroll", updateScrollSearchButton, { passive: true });

render();
updateScrollSearchButton();

function render() {
  const rows = filterRows();
  renderComics(rows);
}

function filterRows() {
  const query = normalize(search.value);
  const proposer = proposerFilter.value;
  const publisher = publisherFilter.value;
  const decade = decadeFilter.value;
  const podcast = podcastFilter.value;

  return comicRows.filter(({ comic, episode }) => {
      const haystack = normalize(
        [
          comic.title,
          comic.runTitle,
          comic.publisher,
          ...comic.writers,
          ...comic.artists,
          ...comic.colorists,
          episode.podcast,
          episode.number,
          episode.proposer,
        ].join(" "),
      );
      const comicPublisher = comic.publisher || "На проверке";
      const comicDecade = comic.decade || decadeFromYear(comic.startYear) || "На проверке";
      return (
        (!query || haystack.includes(query)) &&
        (proposer === "Все заявители" || (episode.proposer || "Общая заявка") === proposer) &&
        (publisher === "Все издательства" || comicPublisher === publisher) &&
        (decade === "Все десятилетия" || comicDecade === decade) &&
        (podcast === "Все форматы" || filterFormat(episode) === podcast) &&
        matchesActiveCriteria(comic)
      );
    });
}

function renderComics(rows) {
  renderActiveFilters();
  comicList.innerHTML = rows.length
    ? renderComicTable(rows)
    : '<p class="error">По этим фильтрам ничего нет.</p>';
}

function renderComicTable(rows) {
  const sortedRows = [...rows]
    .sort(
      (left, right) =>
        right.episode.publication.localeCompare(left.episode.publication) ||
        left.comic.title.localeCompare(right.comic.title, "ru", { sensitivity: "base" }),
    );

  return `<div class="table-wrap panel">
    <table class="comic-table">
      <thead>
        <tr>
          <th>Комикс</th>
          <th>Выпуск</th>
          <th>Дата выпуска</th>
          <th>Издательство</th>
          <th>Сценарист</th>
          <th>Художник</th>
          <th>Колорист</th>
          <th>Год выхода комикса</th>
          <th>Заявка</th>
        </tr>
      </thead>
      <tbody>
        ${sortedRows.map(renderComicRow).join("")}
      </tbody>
    </table>
  </div>`;
}

function renderComicRow({ comic, episode }) {
  const episodeName = episode.number ? `${episode.podcast} #${episode.number}` : episode.episodeTitle || episode.podcast;
  const episodeTitle = episode.link
    ? `<a href="${escapeHtml(episode.link)}" target="_blank" rel="noreferrer">${escapeHtml(episodeName)}</a>`
    : escapeHtml(episodeName);
  const comicUrl = primaryComicUrl(comic);
  const comicTitle = comicUrl
    ? `<a href="${escapeHtml(comicUrl)}" target="_blank" rel="noreferrer">${escapeHtml(comic.title)}</a>`
    : escapeHtml(comic.title);
  const exclusiveMarker = isExclusiveEpisode(episode)
    ? '&#8288;<span class="exclusive-lock" title="Эксклюзив для патронов" aria-label="Эксклюзив для патронов">🔒</span>'
    : "";
  return `<tr>
      <td>
        <strong class="comic-title-line">
          <span class="comic-title-text">${comicTitle}${exclusiveMarker}</span>
        </strong>
      </td>
      <td>${episodeTitle}</td>
      <td>${formatDate(episode.publication)}</td>
      <td>${renderCriterionValue("publisher", comic.publisher || "")}</td>
      <td>${renderCriterionList("writers", comic.writers)}</td>
      <td>${renderCriterionList("artists", comic.artists)}</td>
      <td>${renderCriterionList("colorists", comic.colorists, { emptyLabel: "" })}</td>
      <td>${escapeHtml(comic.startYear || "на проверке")}</td>
      <td>${escapeHtml(episode.proposer || "Общая заявка")}</td>
    </tr>`;
}

function isExclusiveEpisode(episode) {
  if (episode.podcast === "На бонусных панелях" || episode.podcast === "Утешительное чтение" || episode.podcast === "ASOP") {
    return true;
  }
  if (episode.podcast === "На пыльных панелях") {
    const dustNumber = Number(String(episode.number || "").replace(/\D/g, ""));
    return dustNumber === 12 || dustNumber === 13;
  }
  return false;
}

function normalizeComicRecord(comic) {
  return {
    ...comic,
    publisher: comic.publisher || "",
    writers: comic.writers || [],
    artists: comic.artists || [],
    colorists: comic.colorists || [],
    kind: comic.kind || "comic",
    decade: comic.decade || decadeFromYear(comic.startYear),
    discussedIn: comic.discussedIn || [],
    sources: comic.sources || [],
    status: comic.status || "needs-review",
  };
}

function statComicKey({ comic, episode }) {
  if (episode.podcast === "Gol D. Panels") {
    return "one-piece";
  }
  return comic.id;
}

function updateScrollSearchButton() {
  if (!scrollSearchButton) return;
  const searchRect = search.getBoundingClientRect();
  const shouldShow = searchRect.bottom < 0 && comicList.getBoundingClientRect().top < window.innerHeight;
  scrollSearchButton.hidden = !shouldShow;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => {
    if (left === "На проверке") return 1;
    if (right === "На проверке") return -1;
    return left.localeCompare(right, "ru", { sensitivity: "base" });
  });
}

function sortProposers(values) {
  const found = new Set(values.filter(Boolean));
  const ordered = proposerOrder.filter((name) => found.has(name));
  const rest = [...found]
    .filter((name) => !proposerOrder.includes(name))
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }));
  return [...ordered, ...rest];
}

function toOptions(values, labels = {}) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value)}</option>`)
    .join("");
}

function filterFormat(episode) {
  for (const [group, members] of formatGroups) {
    if (members.has(episode.podcast)) return group;
  }
  return episode.podcast;
}

function compareFormats(left, right) {
  const leftIndex = formatOrder.indexOf(left);
  const rightIndex = formatOrder.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }

  const leftCyrillic = startsWithCyrillic(left);
  const rightCyrillic = startsWithCyrillic(right);
  if (leftCyrillic !== rightCyrillic) return leftCyrillic ? -1 : 1;

  return left.localeCompare(right, "ru", { sensitivity: "base" });
}

function startsWithCyrillic(value) {
  return /^\p{Script=Cyrillic}/u.test(value.trim());
}

function decadeFromYear(year) {
  if (!year) return "";
  return `${Math.floor(year / 10) * 10}-е`;
}

function joinCredit(values) {
  return values?.length ? values.join(", ") : "на проверке";
}

function renderCriterionList(group, values, options = {}) {
  if (!values?.length) return options.emptyLabel ?? "на проверке";
  return values
    .map((value, index) => `<span class="criterion-item">${renderCriterionValue(group, value, { suffix: index < values.length - 1 ? "," : "" })}</span>`)
    .join(" ");
}

function renderCriterionValue(group, value, options = {}) {
  if (!value) return "на проверке";
  const selected = activeCriteria[group]?.has(normalize(value));
  return `<button class="criterion-link${selected ? " is-selected" : ""}" type="button" data-filter-group="${escapeHtml(group)}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}${escapeHtml(options.suffix || "")}</button>`;
}

function handleCriterionClick(event) {
  const button = event.target.closest("[data-filter-group][data-filter-value]");
  if (!button || !comicList.contains(button)) return;
  addCriterion(button.dataset.filterGroup, button.dataset.filterValue);
}

function handleCriterionRemove(event) {
  const button = event.target.closest("[data-remove-group][data-remove-value]");
  if (!button) return;
  removeCriterion(button.dataset.removeGroup, button.dataset.removeValue);
}

function addCriterion(group, value) {
  if (!activeCriteria[group] || !value) return;
  activeCriteria[group].set(normalize(value), value);
  render();
}

function removeCriterion(group, value) {
  if (!activeCriteria[group]) return;
  activeCriteria[group].delete(normalize(value));
  render();
}

function matchesActiveCriteria(comic) {
  return (
    matchesCriterionGroup("publisher", [comic.publisher]) &&
    matchesCriterionGroup("writers", comic.writers) &&
    matchesCriterionGroup("artists", comic.artists) &&
    matchesCriterionGroup("colorists", comic.colorists)
  );
}

function matchesCriterionGroup(group, values = []) {
  const selected = activeCriteria[group];
  if (!selected?.size) return true;
  const keys = new Set(values.filter(Boolean).map(normalize));
  return [...selected.keys()].some((key) => keys.has(key));
}

function renderActiveFilters() {
  const chips = Object.entries(activeCriteria).flatMap(([group, values]) =>
    [...values.values()].map(
      (value) => `<button class="filter-chip" type="button" data-remove-group="${escapeHtml(group)}" data-remove-value="${escapeHtml(value)}">
        <span>${escapeHtml(criterionLabels[group])}: ${escapeHtml(value)} (${criterionResultCount(group, value)})</span>
        <span aria-hidden="true">×</span>
      </button>`,
    ),
  );
  activeFilters.hidden = !chips.length;
  activeFilters.innerHTML = chips.length ? chips.join("") : "";
}

function criterionResultCount(group, value) {
  return comicRows.filter(({ comic, episode }) =>
    matchesBaseFilters(comic, episode) &&
    matchesActiveCriteria(comic) &&
    matchesCriterionGroupValue(group, value, comic)
  ).length;
}

function matchesBaseFilters(comic, episode) {
  const query = normalize(search.value);
  const proposer = proposerFilter.value;
  const publisher = publisherFilter.value;
  const decade = decadeFilter.value;
  const podcast = podcastFilter.value;
  const haystack = normalize(
    [
      comic.title,
      comic.runTitle,
      comic.publisher,
      ...comic.writers,
      ...comic.artists,
      ...comic.colorists,
      episode.podcast,
      episode.number,
      episode.proposer,
    ].join(" "),
  );
  const comicPublisher = comic.publisher || "На проверке";
  const comicDecade = comic.decade || decadeFromYear(comic.startYear) || "На проверке";
  return (
    (!query || haystack.includes(query)) &&
    (proposer === "Все заявители" || (episode.proposer || "Общая заявка") === proposer) &&
    (publisher === "Все издательства" || comicPublisher === publisher) &&
    (decade === "Все десятилетия" || comicDecade === decade) &&
    (podcast === "Все форматы" || filterFormat(episode) === podcast)
  );
}

function matchesCriterionGroupValue(group, value, comic) {
  const values = {
    publisher: [comic.publisher],
    writers: comic.writers,
    artists: comic.artists,
    colorists: comic.colorists,
  }[group] || [];
  return values.filter(Boolean).map(normalize).includes(normalize(value));
}

function primaryComicUrl(comic) {
  const directUrl = isUsefulComicUrl(comic.url) ? comic.url : "";
  const sourceUrl =
    comic.sources?.find((source) => source.label === "Comic Vine")?.url ||
    comic.sources?.find((source) => isUsefulComicUrl(source.url))?.url ||
    "";
  return (
    directUrl ||
    sourceUrl
  );
}

function isUsefulComicUrl(url) {
  return Boolean(url && !/docs\.google\.com\/spreadsheets/i.test(url));
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function normalize(value) {
  return String(value).toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function setText(id, text) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
