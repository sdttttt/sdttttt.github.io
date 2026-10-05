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

| File (relative to `themes/sdttttt-paper/`) | Origin   | Diff vs upstream                                                                                                                            |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `layouts/_default/baseof.html`             | copied   | adds `{{ partial "bg.html" . }}` before `</body>`                                                                                           |
| `layouts/partials/header.html`             | forked   | dark-mode JS defaults to light; does not follow `prefers-color-scheme`                                                                      |
| `layouts/partials/footer.html`             | copied   | removes the "powered by hugo" + "hugo-paper" links                                                                                          |
| `layouts/partials/bg.html`                 | new      | page-level decorative background (random avif/webp image + WASM particles, revealed on scroll-to-bottom)                                    |
| `layouts/_default/archives.html`           | new      | `/archives/` — posts grouped by year → month, each month one compact inline flow (no upstream counterpart)                                  |
| `assets/custom.css`                        | extended | all `.page-bg` / `.page-bg__img` / `.arch*` rules + custom CSS (⚠️ `font-size` on headings needs `!important`, see the comment in the file) |

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
