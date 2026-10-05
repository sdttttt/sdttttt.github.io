# sdttttt-paper

`sdttttt-paper` is a personal fork of [`nanxiaobei/hugo-paper`](https://github.com/nanxiaobei/hugo-paper), packaged as a Hugo sub-theme via Hugo's `[parent]` block. It inherits all upstream layouts/assets and overrides a small set of files for personal customization.

## What this theme owns

| File (relative to `themes/sdttttt-paper/`) | Origin   | Diff vs upstream                                                           |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------- |
| `layouts/_default/baseof.html`             | copied   | adds `{{ partial "bg.html" . }}` before `</body>`                          |
| `layouts/partials/header.html`             | forked   | dark-mode JS defaults to light; does not follow `prefers-color-scheme`     |
| `layouts/partials/footer.html`             | copied   | removes the "powered by hugo" + "hugo-paper" links                         |
| `layouts/partials/bg.html`                 | new      | page-level decorative background (random PNG revealed on scroll-to-bottom) |
| `assets/custom.css`                        | extended | all `.page-bg` / `.page-bg__img` rules + custom CSS                        |

Everything else (`head.html`, `list.html`, single.html, `assets/main.css`, …) falls through to the parent theme `themes/hugo-paper/`.

## Using this theme

In your `hugo.toml`:

```toml
theme = "sdttttt-paper"
```

Hugo requires the parent (`themes/hugo-paper/`) to be present alongside this theme — no `themes.toml` or Hugo modules needed, it's plain directory-based resolution.

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
- Vendored parent: `themes/hugo-paper/` (last synced 2026-10-05, master @ 996fac9)
