# Docs site

Astro + [Starlight](https://starlight.astro.build) site, deployed to GitHub Pages by
[.github/workflows/docs.yml](../.github/workflows/docs.yml) on every push to `main` that
touches `site/`, `README.md` or `docs/assets/`.

The homepage is generated from the repo root's `README.md`, not written by hand: running
`dev` or `build` first runs `scripts/sync-readme.mjs`, which copies `../README.md` into
`src/content/docs/index.md` and `../docs/assets/` into `src/assets/readme/`, rewriting
image paths and `{#custom-id}` heading anchors along the way. Both generated paths are
gitignored — edit `../README.md`, not the generated files, then rerun `npm run dev`.

To add more pages, drop additional `.md`/`.mdx` files under `src/content/docs/` — they
pick up the sidebar automatically (see `sidebar` in `astro.config.mjs`).

## Commands

Run from `site/`:

| Command               | Action                                             |
| :-------------------- | :------------------------------------------------- |
| `npm install`         | Install dependencies                               |
| `npm run dev`         | Regenerate the homepage, then start the dev server |
| `npm run build`       | Regenerate the homepage, then build to `./dist/`   |
| `npm run preview`     | Preview the production build locally               |
| `npm run sync-readme` | Regenerate the homepage/assets without building    |
