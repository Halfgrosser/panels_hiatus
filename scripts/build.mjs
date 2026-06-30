import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const name of ["index.html", "comics.html", "styles.css", "app.js", "comics.js", "assets", "data"]) {
  await cp(resolve(root, name), resolve(dist, name), { recursive: true });
}

await mkdir(resolve(dist, "comics"), { recursive: true });
const nestedComicsHtml = (await readFile(resolve(root, "comics.html"), "utf8"))
  .replaceAll('href="./assets/', 'href="../assets/')
  .replaceAll('src="./assets/', 'src="../assets/')
  .replaceAll('href="./styles.css', 'href="../styles.css')
  .replaceAll('src="./data/', 'src="../data/')
  .replaceAll('src="./comics.js', 'src="../comics.js')
  .replace('href="./">Календарь', 'href="../">Календарь')
  .replace('href="./comics">Комиксы', 'href="./">Комиксы');
await writeFile(resolve(dist, "comics", "index.html"), nestedComicsHtml, "utf8");

console.log(`Static build created at ${dist}`);
