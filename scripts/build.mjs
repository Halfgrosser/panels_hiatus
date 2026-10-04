import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const mustread = JSON.parse(await readFile(resolve(root, "data/mustread/provenance.json"), "utf8"));
if (mustread.failures.length || mustread.pending.length || mustread.sources.some((source) => source.entries.length !== 100)) {
  throw new Error("Mustread import is incomplete. Finish npm run import:mustread before building.");
}
await Promise.all(mustread.assets.map((asset) => access(resolve(root, "assets/mustread", asset.filename))));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const name of ["index.html", "comics.html", "mustread.html", "mustread2.html", "styles.css", "app.js", "comics.js", "episode-links.js", "assets", "data"]) {
  await cp(resolve(root, name), resolve(dist, name), { recursive: true });
}

for (const page of ["comics", "mustread", "mustread2"]) {
  await mkdir(resolve(dist, page), { recursive: true });
  const nestedHtml = (await readFile(resolve(root, `${page}.html`), "utf8"))
    .replaceAll('href="./', 'href="../')
    .replaceAll('src="./', 'src="../');
  await writeFile(resolve(dist, page, "index.html"), nestedHtml, "utf8");
}

console.log(`Static build created at ${dist}`);
