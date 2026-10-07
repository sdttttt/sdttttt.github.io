# self

The Hugo theme behind <https://sdttttt.online/>. It is a fork of [`nanxiaobei/hugo-paper`](https://github.com/nanxiaobei/hugo-paper), but **upstream sync was dropped on 2026-10-07**: the previously vendored `themes/hugo-paper/` was merged into this directory, so this is now the only theme in the repository.

## How it is wired up

In the site's `hugo.toml`:

```toml
theme = "self"
```

That's it — no theme list, no Hugo Modules, no `go.mod`, no `[parent]` block. (`[parent]` is a Hugo Modules concept and is a no-op for directory-based themes.)

Hugo overlays `layouts/`, `assets/`, `static/` and `i18n/` from the theme onto the site's own directories, with the site winning on conflicts. That's why `static/apple-touch-icon.png` and `static/favicon.ico` are owned by the **site**, not by this theme.

## What lives here

Files either come from upstream, or they are ours. The ones below are ours — edit them freely:

| File (relative to `themes/self/`)            | Origin                   | What it does                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layouts/_default/baseof.html`               | copied                   | adds the trailing `{{ partial "bg.html" . }}` and resolves `avatar_url` only on the home page (so upstream's unconditional avatar preload is skipped elsewhere; the `social_list` scratch + social-icon nav were dropped, see the `header.html` row)                                                            |
| `layouts/_default/list.html`                 | copied                   | upstream's list layout plus the archive/tag customizations                                                                                                                                                                                                                                                      |
| `layouts/_default/particles.html`            | new                      | `/particles/` — the WASM particle playground (**`draft: true`**, never published; view locally with `hugo server -D`)                                                                                                                                                                                           |
| `layouts/_default/archives.html`             | new                      | `/archives/` — posts grouped by year → month, each month one compact inline flow                                                                                                                                                                                                                                |
| `layouts/_default/search.html`               | new                      | `/search/` — client-side search box + result list; pairs with `layouts/index.json` + `assets/js/search.js`                                                                                                                                                                                                      |
| `layouts/index.json`                         | new                      | build-time search index (`/searchindex.json`), declared via `[outputFormats.JSON]` in `hugo.toml`                                                                                                                                                                                                               |
| `layouts/_default/_markup/render-image.html` | new                      | image render hook: adds `loading="lazy"` + `decoding="async"` everywhere, and turns the `title` of the `/images/image-lost.svg` placeholder into a caption line under the image (`.IsBlock` is always false on this Hugo version, and the image sits inside a `<p>`, hence a `<span>`, not `figure/figcaption`) |
| `layouts/partials/head.html`                 | forked                   | dropped `<meta name="description">` (front matter `description` still feeds og/twitter/schema), the `AlternativeOutputFormats` RSS `<link>`, the highlight.js loader, the `math.html` call and the social-icon preloads                                                                                         |
| `layouts/_default/single.html`               | forked                   | dropped the Disqus / GraphComment / giscus / mermaid blocks (none of their config keys was ever set)                                                                                                                                                                                                            |
| `layouts/partials/header.html`               | forked                   | dark-mode JS defaults to light and ignores `prefers-color-scheme`; the social-icon nav was deleted (its `twitter.svg` / `github.svg` / … were never vendored, and its `rss` branch pointed at the now-removed `/index.xml`)                                                                                     |
| `layouts/partials/footer.html`               | copied                   | removes upstream's "powered by hugo" + "hugo-paper" links                                                                                                                                                                                                                                                       |
| `layouts/partials/bg.html`                   | new                      | the decorative bottom-left badge: random avif/webp background + a scroll-revealed WASM particle render (the engine only warms up once the reader nears the page bottom)                                                                                                                                         |
| `layouts/robots.txt`                         | new                      | overrides Hugo's built-in `robots.txt` to add the `Sitemap:` line                                                                                                                                                                                                                                               |
| `assets/custom.css`                          | extended                 | all `.page-bg` / `.arch*` / `.search*` rules plus site-wide tweaks (⚠️ Tailwind v4's `:not(#\#)` bumpers beat plain class selectors, so `font-size` on headings needs `!important` — see the comment in the file)                                                                                               |
| `assets/js/page-bg.js`                       | new                      | badge state machine (wasm warm-up, wipe-in reveal, idle float, lazy image pick)                                                                                                                                                                                                                                 |
| `assets/js/pt-wasm.js`                       | new                      | shared wasm loader (`WebAssembly` capability check lives here)                                                                                                                                                                                                                                                  |
| `assets/js/particles-wasm.js`                | new                      | engine driver for `/particles/`                                                                                                                                                                                                                                                                                 |
| `assets/js/particles.js`                     | new                      | pure Canvas 2D fallback for `/particles/`                                                                                                                                                                                                                                                                       |
| `assets/js/search.js`                        | new                      | `/search/` logic: lazy index fetch, scoring, highlight, keyboard nav, `?q=` sync                                                                                                                                                                                                                                |
| `assets/wasm/particles.wasm` + `.sha256`     | committed build artifact | the Rust engine compiled from `wasm/particles/`; rebuild with `deno task build-wasm` and commit both files                                                                                                                                                                                                      |
| `static/theme.svg`                           | copied                   | the dark-mode toggle icon; the `monoDarkIcon` flag and `theme.png` were deleted on 2026-10-07                                                                                                                                                                                                                   |
| `theme.toml`                                 | forked                   | theme metadata                                                                                                                                                                                                                                                                                                  |

Everything else — `layouts/404.html`, `layouts/_default/list.html` (outside the archive/tag additions above), `LICENSE` — is untouched upstream code.

### The Tailwind pipeline

`assets/app.css` is the Tailwind v4 source (`@import 'tailwindcss'`, `@plugin '@tailwindcss/typography'`, `@custom-variant dark`, `@theme`, the dark-mode utility); `assets/main.css` is its **compiled output, committed to the repo**. Hugo does not compile it — `layouts/partials/head.html` only concatenates it with `assets/custom.css`, minifies and fingerprints. Upstream's `package.json` / `bun.lock` / `postcss.config.mjs` went missing when the themes were merged, which left `main.css` editable only by hand; they were restored on 2026-10-07:

```bash
deno task build-css   # = bin/build-css.sh: bun install --frozen-lockfile, then postcss, then refresh the fingerprint
```

Details that are easy to lose:

- **Never hand-edit `assets/main.css`** — edit `app.css` (or `custom.css` for site-only rules) and rebuild.
- `bun.lock` is vendored verbatim from upstream, unused devDependencies included, and must be installed with `--frozen-lockfile`: the output is sensitive to the resolved versions of `postcss-preset-env`'s transitive `@csstools/*` packages, so a fresh resolve compiles different bytes from the same `app.css` (observed: `#0000` becoming `rgba(0,0,0,0)`).
- Tailwind v4 scans **the directory it is run from** (the theme root), not just templates: `README.md`, `i18n/*.yaml` and _the previous `main.css` itself_ are all inputs. That is how dead rules survive — every rebuild re-emits whatever the last output contained (upstream's deleted `exampleSite/` is why the social-icon classes lingered) — and why a prose edit here can add a rule of its own (`collapse` came from this file).
- Do not spell out real class names in prose here: writing the literal name of the `@utility` declared in `app.css` into this file took the compiled output from 57,943 to 58,801 bytes, purely by giving that utility's selector one extra `:not(#\#)` specificity bumper; dropping the word restored byte-for-byte identity.
- CI installs neither bun nor Rust, so `assets/main.css.sha256` records the artifact plus every scanned file; `./bin/artifacts.sh check` fails when they disagree, and `./bin/artifacts.sh check --rebuild` recompiles and compares bytes locally (needs bun + `themes/self/node_modules`).

Deleted on 2026-10-07 — all of it dead code (no config key set, no content using it, or no asset ever vendored):

- `layouts/partials/math.html` + `layouts/partials/mermaid.html` — 0 posts used KaTeX or mermaid, and the `localKatex` branch pointed at `katex.min.css` / `auto-render.min.js`, which were never in `static/`.
- `layouts/shortcodes/collapse.html` — 0 shortcode invocations site-wide.
- 20 of the 21 `i18n/*.yaml` — the site is zh-only and only `prev_page` / `next_page` are ever looked up; `zh.yaml` stays.
- the social-icon nav (see the `header.html` / `baseof.html` rows above).

RSS is off site-wide: `hugo.toml`'s `[outputs]` pins `section` / `taxonomy` / `term` to `["HTML"]`. That is not decoration — dropping `"RSS"` from `home` alone still leaves `/tags/*/index.xml`, `/changelog/index.xml` and friends, because those come from Hugo's own defaults for those page kinds. To bring RSS back, add `"RSS"` to `home` and delete those three lines.

## History

- Upstream: <https://github.com/nanxiaobei/hugo-paper>
- 2026-10-05 — `hugo-paper` vendored into `themes/hugo-paper/`, with `sdttttt-paper` as a thin override layer on top.
- 2026-10-07 — the two directories merged into one theme; upstream sync dropped.
- 2026-10-07 — that theme renamed `sdttttt-paper` → `self`; `hugo.toml` reduced to `theme = "self"`.
- 2026-10-07 — dead-feature sweep: RSS generation turned off site-wide, `<meta name="description">` removed, comment systems / KaTeX / mermaid / highlight.js / the `collapse` shortcode deleted, `i18n/` trimmed to `zh.yaml`, social-icon nav dropped.
- 2026-10-07 — the last dead CSS in `assets/main.css` (27 selectors left over from the deleted social-icon nav and upstream's `exampleSite/`) was removed by hand, then the whole file was reproduced by rebuilding Tailwind: `package.json` / `bun.lock` / `postcss.config.mjs` vendored back, `deno task build-css` added, artifact fingerprinted as `assets/main.css.sha256`. The `monoDarkIcon` flag and `theme.png` were dropped along the way.
