/*
 * UnoCSS 配置（`self` 主题的 CSS 管线）。
 *
 * 这里只放「源」：预设与扫描范围。`unocss` CLI 据此把 reset / 主题变量 / typography /
 * 工具类生成到 assets/uno.css（bin/build-css.sh）；主题自己的规则写在 assets/app.css
 * （普通 CSS，没有 @apply），站点自有样式在 assets/custom.css，两者由 Hugo 在
 * head.html 里跟在 uno.css 后面 concat。
 *
 * 与原来的 Tailwind v4 相比：
 *   · `@theme { --w: ... }` → `:root` 里的普通自定义属性（UnoCSS 没有 CSS-first 的
 *     主题语法，这一个变量也不需要进预设）
 *   · `@plugin '@tailwindcss/typography'` → presetTypography()
 *   · `@custom-variant dark` → presetWind4 内置的 class 型 dark 变体（`html.dark` 下生效）
 *
 * content.filesystem 的相对路径以构建时的 cwd（themes/self）为准：只有 layouts 里
 * 的类名会被扫描。assets/js 里没有工具类（只加 is-particle / pt-bg-on 这类自定义
 * 类），所以不必扫；将来若在 JS 里拼工具类，记得把目录加进来。
 *
 * 注意「按需发射」：没有被任何模板用到的主题变量不会出现在产物里，所以 app.css
 * 不能依赖 var(--colors-*) / var(--radius-*) 这类 token，得写字面量。
 */
import presetWind4 from '@unocss/preset-wind4'
import presetTypography from '@unocss/preset-typography'

export default {
  presets: [presetWind4(), presetTypography()],
  content: {
    filesystem: ['layouts/**/*.html'],
  },
}
