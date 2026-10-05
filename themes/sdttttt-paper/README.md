# sdttttt-paper

`sdttttt-paper` is a personal fork of [`nanxiaobei/hugo-paper`](https://github.com/nanxiaobei/hugo-paper). It is **not** a standalone theme — it is designed to be combined with the vendored `themes/hugo-paper/` via the site's theme list, so its same-path layouts/assets shadow the upstream ones.

## How it is wired up

In the site's `hugo.toml`:

```toml
theme = ["sdttttt-paper", "hugo-paper"]
```

Hugo resolves layouts/assets by walking the theme list in order, first hit wins:

- `themes/sdttttt-paper/…` is searched first — its files shadow hugo-paper's same-path files.
- Anything missing there (e.g. `head.html`, `list.html`, `single.html`, `assets/main.css`) falls through to `themes/hugo-paper/`.

Both themes live in `themes/`; no Hugo Modules, no `go.mod`, no `[parent]` block. (`[parent]` is a Hugo Modules concept and is a no-op for directory-based theme lists.)

> ⚠️ The order in the `theme` list is load-bearing — `sdttttt-paper` must come before `hugo-paper`, otherwise none of the overrides below take effect.

## What this theme owns

| File (relative to `themes/sdttttt-paper/`) | Origin   | Diff vs upstream                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layouts/_default/baseof.html`             | copied   | adds the trailing `{{ partial "bg.html" . }}` and resolves `avatar_url` only on the home page (so hugo-paper's unconditional avatar preload is skipped off-home; `head.html` stays a fall-through)                                                                |
| `layouts/partials/header.html`             | forked   | dark-mode JS defaults to light; does not follow `prefers-color-scheme`                                                                                                                                                                                            |
| `layouts/partials/footer.html`             | copied   | removes the "powered by hugo" + "hugo-paper" links                                                                                                                                                                                                                |
| `layouts/partials/bg.html`                 | new      | page-level decorative background (random avif/webp image with `fetchpriority="low"` + WASM particles, revealed on scroll-to-bottom; engine only warms up once the reader nears it)                                                                                |
| `layouts/_default/archives.html`           | new      | `/archives/` — posts grouped by year → month, each month one compact inline flow (no upstream counterpart)                                                                                                                                                        |
| `layouts/_default/search.html`             | new      | `/search/` — client-side search box + result list; pairs with `layouts/index.json` + `assets/js/search.js`                                                                                                                                                        |
| `layouts/index.json`                       | new      | build-time search index (`/searchindex.json`, 209 entries); declared via `[outputFormats.JSON]` in `hugo.toml`                                                                                                                                                    |
| `assets/js/search.js`                      | new      | `/search/` logic: lazy index fetch, scoring, highlight, keyboard nav, `?q=` sync                                                                                                                                                                                  |
| `assets/custom.css`                        | extended | all `.page-bg` / `.page-bg__img` / `.arch*` / `.search*` rules + custom CSS (⚠️ Tailwind v4's `:not(#\#)` bumpers beat plain class rules, so `font-size` on headings and `margin`/`padding`/`border` on anything need `!important` — see the comment in the file) |

## Bumping the upstream `hugo-paper`

1. Clone upstream to a scratch dir:

   ```bash
   git clone --depth 1 https://github.com/nanxiaobei/hugo-paper.git /tmp/hp-clone
   ```

2. Diff against `themes/hugo-paper/`:

   ```bash
   diff -ru themes/hugo-paper/ /tmp/hp-clone/
   ```

3. Apply desired upstream changes to `themes/hugo-paper/` directly (it's vendored, not a submodule).

4. For each of this theme's overrides listed above, re-sync the upstream version and reapply the local diff. The file headers document what to sync against.

## Origins

- Upstream: <https://github.com/nanxiaobei/hugo-paper>
- Vendored parent: `themes/hugo-paper/` (last synced 2026-10-05)
