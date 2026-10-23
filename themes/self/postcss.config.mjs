import UnoCSS from '@unocss/postcss'
import postcssPresetEnv from 'postcss-preset-env'

/*
 * UnoCSS 的主题变量是按需发射的（`preflights.theme` 默认 'on-demand'），而内容扫描
 * 是并发跑的 —— 同一份源连编译两次，变量**集合**相同、**顺序**会跟着扫描完成顺序
 * 抖动。`bin/artifacts.sh` 的指纹是逐字节比的，这一抖就等于「改了源却没重建」，
 * 每次构建都得重新 stamp。
 *
 * 这里把主题变量块的声明按属性名排序，把顺序钉死；变量之间没有层叠关系，排序不影响
 * 结果（实测渲染后的计算样式逐项一致）。代价是放弃了 UnoCSS 的原始顺序。
 */
function sortThemeVariables() {
  return {
    postcssPlugin: 'sort-theme-variables',
    Once(root) {
      root.walkRules((rule) => {
        if (!/^:root\b/.test(rule.selector)) return
        const decls = []
        let onlyVars = true
        rule.each((node) => {
          if (node.type === 'decl') {
            if (!node.prop.startsWith('--')) onlyVars = false
            decls.push(node)
          } else if (node.type !== 'comment') {
            onlyVars = false
          }
        })
        if (!onlyVars || decls.length < 2) return
        const sorted = [...decls].sort((a, b) =>
          a.prop < b.prop ? -1 : a.prop > b.prop ? 1 : 0,
        )
        decls.forEach((d) => d.remove())
        sorted.forEach((d) => rule.append(d))
      })
    },
  }
}

export default {
  plugins: [
    UnoCSS(),
    postcssPresetEnv({
      features: {
        'oklab-function': true,
        'custom-properties': false, // Let UnoCSS handle variables
      },
      autoprefixer: false, // UnoCSS emits its own prefixes via presetWind4
      preserve: false,
    }),
    sortThemeVariables(),
  ],
}
