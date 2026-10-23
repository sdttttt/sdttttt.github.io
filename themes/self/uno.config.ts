/*
 * UnoCSS 配置（`self` 主题的 CSS 管线）。
 *
 * 这里只放「源」：预设、扫描范围、少量配置。样式本身仍然写在 assets/app.css
 * （自定义类 / @apply）与 assets/custom.css（站点自有样式）里。
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
 */
import presetWind4 from '@unocss/preset-wind4'
import presetTypography from '@unocss/preset-typography'

export default {
  presets: [presetWind4(), presetTypography()],
  content: {
    filesystem: ['layouts/**/*.html'],
  },
}
