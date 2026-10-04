// One-time archival import. Requires the two original HTML files in .cache/mustread.
// Existing calendar/catalog data is never read or written by this importer.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const sources = [
  { slug: "mustread", snapshot: "20260416205750", original: "https://spidermedia.ru/mustread", label: "Мастрид 1" },
  { slug: "mustread2", snapshot: "20260416020457", original: "http://spidermedia.ru/mustread2", label: "Мастрид 2" },
];
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const normalize = (text) => text.replace(/\s+/g, " ").trim();
const archiveUrl = (url, source, raw = false) => `https://web.archive.org/web/${source.snapshot}${raw ? "id_" : ""}/${url}`;
const assetDir = resolve(root, "assets/mustread");
await mkdir(assetDir, { recursive: true });
const assets = new Map();
const reports = [];
const imageLimit = Number(process.env.MUSTREAD_IMAGE_LIMIT || Infinity);
const isImage = (bytes) => (bytes[0] === 0xff && bytes[1] === 0xd8) || bytes.subarray(0, 3).toString() === "GIF" || bytes[0] === 0x89 || bytes.subarray(0, 4).toString() === "RIFF";

function imageAsset(image, source) {
  const original = new URL(image.getAttribute("src"), "http://spidermedia.ru/").href;
  const id = createHash("sha256").update(original).digest("hex").slice(0, 12);
  const extension = extname(new URL(original).pathname).toLowerCase() || ".jpg";
  const filename = `${id}${extension}`;
  if (!assets.has(original)) {
    const fullImage = image.closest("a")?.getAttribute("href");
    assets.set(original, { original, filename, source, fullImage: fullImage ? new URL(fullImage, "http://spidermedia.ru/").href : null });
  }
  return `./assets/mustread/${filename}`;
}

function linkUrl(value, source) {
  if (value.startsWith("#")) return value;
  let url;
  try { url = new URL(value, "http://spidermedia.ru/"); } catch { return null; }
  if (!["https:", "http:"].includes(url.protocol)) return null;
  if (url.hostname.replace(/^www\./, "") === "spidermedia.ru") {
    if (["/mustread", "/mustread2"].includes(url.pathname.replace(/\/$/, ""))) {
      return `.${url.pathname.replace(/\/$/, "")}${url.hash}`;
    }
    return archiveUrl(url.href, source);
  }
  return url.href;
}

const allowed = new Set(["p", "div", "span", "b", "strong", "i", "em", "u", "s", "br", "ul", "ol", "li", "a", "img", "details", "summary", "blockquote", "h2", "h3", "h4", "hr"]);
const classes = new Set(["moment-number", "moment-info", "moment-autor", "comics-cat"]);
function clean(node, source, title = "") {
  if (node.nodeType === 3) return escape(node.textContent);
  if (node.nodeType !== 1) return "";
  let tag = node.localName;
  if (["script", "style", "object", "embed"].includes(tag)) return "";
  if (tag === "iframe") {
    const href = linkUrl(node.getAttribute("src") || "", source);
    return href ? `<a href="${escape(href)}">Подкаст к подборке</a>` : "";
  }
  const children = [...node.childNodes].map((child) => clean(child, source, title)).join("");
  if (!allowed.has(tag)) return children;
  if (tag === "span" && /font-weight\s*:\s*(bold|[7-9]00)/i.test(node.getAttribute("style") || "")) tag = "strong";
  if (node.classList.contains("clear")) return "";
  if (tag === "img") {
    const src = imageAsset(node, source);
    return `<img src="${src}" alt="${escape(node.getAttribute("alt") || (title ? `Обложка ${title}` : "Иллюстрация к подборке"))}" loading="lazy" decoding="async" />`;
  }
  let attributes = "";
  const retained = [...node.classList].filter((name) => classes.has(name));
  if (retained.length) attributes += ` class="${retained.join(" ")}"`;
  if (tag === "a") {
    const href = linkUrl(node.getAttribute("href") || "", source);
    if (!href) return children;
    attributes += ` href="${escape(href)}"`;
  }
  if (tag === "ol" && /^\d+$/.test(node.getAttribute("start") || "")) attributes += ` start="${node.getAttribute("start")}"`;
  if (["br", "hr"].includes(tag)) return `<${tag} />`;
  return `<${tag}${attributes}>${children}</${tag}>`;
}

const template = await readFile(resolve(root, "index.html"), "utf8");
for (const source of sources) {
  const html = await readFile(resolve(root, `.cache/mustread/${source.slug}.html`), "utf8");
  const { document } = parseHTML(html);
  const content = document.querySelector(".page .text");
  const blocks = [...content.querySelectorAll(".list-moment")];
  if (blocks.length !== 100) throw new Error(`${source.slug}: expected 100 entries, found ${blocks.length}`);
  const title = document.querySelector("h1.title").textContent;
  const pageInfo = document.querySelector(".page-info").cloneNode(true);
  pageInfo.querySelector(".count")?.remove();
  const byline = normalize(pageInfo.textContent);
  const introHtml = content.innerHTML.slice(0, content.innerHTML.indexOf('<div class="list-moment"'));
  const intro = parseHTML(`<div id="intro">${introHtml}</div>`).document.querySelector("#intro");
  const entries = blocks.map((block, index) => {
    const number = normalize(block.querySelector(".number-moment").textContent);
    if (number !== String(index + 1)) throw new Error(`${source.slug}: invalid numbering at ${index + 1}`);
    const heading = block.querySelector(".moment-title");
    const headingLabel = heading.cloneNode(true);
    headingLabel.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
    const name = normalize(headingLabel.textContent);
    const body = block.querySelector(".moment-content").cloneNode(true);
    body.querySelector(".moment-title").remove();
    const imageNodes = [...block.querySelectorAll(".image-moment img")];
    const gallery = imageNodes.map((image) => `<a class="mustread-cover" href="${imageAsset(image, source)}" aria-label="${escape(`Обложка ${name}`)}">${clean(image, source, name)}</a>`).join("");
    const headingHtml = [...heading.childNodes].map((node) => clean(node, source, name)).join("");
    const bodyHtml = [...body.childNodes].map((node) => clean(node, source, name)).join("");
    return { number, name, text: normalize(body.textContent), images: imageNodes.length,
      html: `<article class="mustread-entry panel" id="${number}" aria-labelledby="comic-${number}">
        <div class="mustread-entry__number"><a href="#${number}" aria-label="Позиция ${number}">${number}</a></div>
        <div class="mustread-entry__visual"><div class="mustread-gallery" tabindex="0" aria-label="Обложки ${escape(name)}">${gallery}</div>${imageNodes.length > 1 ? `<p class="mustread-gallery__hint">Обложки: ${imageNodes.length}. Листайте вбок.</p>` : ""}</div>
        <div class="mustread-entry__body"><h2 id="comic-${number}">${headingHtml}</h2>${bodyHtml}</div>
      </article>` };
  });
  const toc = entries.map((entry) => `<li><a href="#${entry.number}">${escape(entry.name)}</a></li>`).join("\n");
  const sourceLink = archiveUrl(source.original, source);
  let page = template.slice(0, template.indexOf('      <section class="panel controls"'));
  page = page.replace('<title>На Панелях — Hiatus Chart</title>', `<title>${escape(title)} | На Панелях</title>`)
    .replace('content="Календарь выпусков и пауз подкаста «На Панелях» с 2017 года."', `content="${escape(title)}. Сохраненная подборка SpiderMedia с описаниями, обложками и рекомендациями."`)
    .replace('<br />Hiatus Chart</h1>', `<br />${source.label}</h1>`)
    .replace('Архив с 2017 года', 'Подборки SpiderMedia')
    .replace('Все, что происходит в выпусках и между ними', 'Комиксы, с которых стоит начать, и те, которые стоит открыть следом')
    .replace('site-nav__link is-active', 'site-nav__link')
    .replace(`class="site-nav__link" href="./${source.slug}"`, `class="site-nav__link is-active" href="./${source.slug}" aria-current="page"`);
  page += `      <section class="mustread-intro panel" aria-labelledby="mustread-title">
        <p class="kicker">${escape(byline)}</p>
        <h2 id="mustread-title">${escape(title)}</h2>
        <p class="mustread-source">Подборка сохранена со SpiderMedia. <a href="${sourceLink}">Архив оригинала</a> от 16 апреля 2026 года. Тексты и сведения об изданиях приведены по архивной версии.</p>
        ${[...intro.childNodes].map((node) => clean(node, source)).join("")}
        <details class="mustread-toc"><summary>Все 100 комиксов</summary><ol>${toc}</ol></details>
      </section>
      <section class="mustread-list" aria-label="100 рекомендуемых комиксов">${entries.map((entry) => entry.html).join("\n")}</section>
      <footer class="footer"><p>Источник: <a href="${sourceLink}">${escape(title)} · SpiderMedia</a></p><p><a href="#">Наверх</a> · <a href="./${source.slug === "mustread" ? "mustread2" : "mustread"}">${source.slug === "mustread" ? "Еще 100 комиксов" : "Первые 100 комиксов"}</a></p></footer>
    </main>
  </body>
</html>\n`;
  await writeFile(resolve(root, `${source.slug}.html`), page.replaceAll("\r\n", "\n").replace(/[\t ]+$/gm, ""));
  reports.push({ ...source, title, byline, entries: entries.map(({ html, ...entry }) => entry) });
}

async function download(asset) {
  const target = resolve(assetDir, asset.filename);
  try { if (isImage(await readFile(target))) return; } catch { /* Not cached yet. */ }
  const candidates = [asset.original, asset.original.replace("http:", "https:"), asset.fullImage].filter(Boolean);
  let lastError = "";
  for (const candidate of [...new Set(candidates)]) {
    try {
      await run("curl", ["-fL", "--silent", "--show-error", "--max-time", "30", "--retry", "1", "--retry-all-errors", "--retry-delay", "2", "-o", target, archiveUrl(candidate, asset.source, true)], { maxBuffer: 1024 * 1024 });
      const bytes = await readFile(target);
      if (!isImage(bytes)) throw new Error("Not an image");
      return;
    } catch (error) { lastError = error.stderr || error.message; }
  }
  throw new Error(`Image unavailable: ${asset.original}: ${lastError.trim()}`);
}
const missing = [];
for (const asset of assets.values()) {
  try { if (isImage(await readFile(resolve(assetDir, asset.filename)))) continue; } catch { /* Missing. */ }
  missing.push(asset);
}
const queue = missing.slice(0, imageLimit);
const failures = [];
let finished = 0;
await Promise.all(Array.from({ length: 1 }, async () => {
  while (queue.length) {
    const asset = queue.shift();
    try { await download(asset); } catch (error) { failures.push(error.message); console.error(error.message); }
    finished++;
    if (finished % 10 === 0) console.log(`Images downloaded this pass: ${finished}/${Math.min(missing.length, imageLimit)}`);
  }
}));
await mkdir(resolve(root, "data/mustread"), { recursive: true });
const pending = missing.slice(imageLimit).map((asset) => asset.original);
await writeFile(resolve(root, "data/mustread/provenance.json"), JSON.stringify({ sources: reports, assets: [...assets.values()].map(({ source, ...asset }) => ({ ...asset, snapshot: source.snapshot })), failures, pending }, null, 2) + "\n");
if (failures.length) throw new Error(failures.join("\n"));
console.log(`Imported 200 entries; images saved: ${assets.size - failures.length - pending.length}/${assets.size}.`);
