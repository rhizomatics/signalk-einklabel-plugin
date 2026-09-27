# Docs site

Astro + [Starlight](https://starlight.astro.build) site, deployed to GitHub Pages by
[.github/workflows/docs.yml](../.github/workflows/docs.yml) on every push to `main` that
touches `site/`, `README.md` or `docs/`.

No page is written here by hand: running `dev` or `build` first runs `scripts/sync-docs.mjs`,
which builds the home page from the repo root's `README.md` and one page per Markdown file
under `../docs/` (a directory's `README.md` becoming its index page), and copies `../docs/assets/`
into `src/assets/readme/`. Along the way it turns relative `.md` links into site routes, points
images at the copied assets, and converts GitHub `> [!TIP]`-style alerts into Starlight asides.
The generated paths are gitignored - edit `../README.md` or `../docs/`, not the generated files.
While `npm run dev` is running, edits there are re-synced and the browser reloads automatically.

To add a page, add a Markdown file under `../docs/` and, unless it's under `../docs/examples/`
(listed automatically), add it to `sidebar` in `astro.config.mjs`.

The [starlight-llms-txt](https://delucis.github.io/starlight-llms-txt/) plugin also publishes the pages
as plain Markdown for coding agents: `/llms.txt` (an index, following [llmstxt.org](https://llmstxt.org/)),
`/llms-full.txt` (every page) and `/llms-small.txt` (the same with tip/note asides stripped). Its summary
and links are set in `astro.config.mjs`.

The examples pages' template reference tables are generated from the bundled templates by the
plugin's own `npm run docs:templates` (in the repo root), and committed.

## Commands

Run from `site/`:

| Command             | Action                                          |
| :------------------ | :---------------------------------------------- |
| `npm install`       | Install dependencies                            |
| `npm run dev`       | Regenerate the pages, then start the dev server |
| `npm run build`     | Regenerate the pages, then build to `./dist/`   |
| `npm run preview`   | Preview the production build locally            |
| `npm run sync-docs` | Regenerate the pages/assets without building    |
