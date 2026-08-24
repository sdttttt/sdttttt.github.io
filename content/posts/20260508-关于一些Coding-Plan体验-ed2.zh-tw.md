---
title: "關於一些Coding Plan體驗"
date: 2026-05-08
description: "對比體驗智譜 Pro、ChatGPT Plus、Claude Pro、GitHub Copilot 等 coding plan 以及 Claude Code、OpenCode、Codex 等 coding agent,記錄各家的額度、模型表現和適用場景。"
cover:
  image: "images/covers/20260508-關於一些Coding-Plan體驗-ed2.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2026050802u502/"]
language: "zh-tw"
---

最近我試了幾個的coding plan和coding agent. 這篇文章我就說說我自己的體驗.
由於現在的模型迭代速度很快，馬上有反轉也說不定.

coding Plan: `智譜Pro`,`ChatGPT Plus`,`Claude Pro`, `Github Copilot`, `MiniMax`
coding Agent: `Claude Code`, `Open Code`, `Codex`

### 智譜 Coding Plan

模型能力很強，但是一到高峰很明顯，就是超時，只能退而求其次使用`GLM-4.7`，智譜的算力很明細是不夠的.

而且`GLM-5`有的時候會幹蠢事，完全不聽提示詞的情況.

### Claude Pro

不夠，完全不夠用.

作為目前最頂尖的AI公司，模型能力毋庸置疑，我哪怕發佈幾個很複雜的任務，提示詞也沒幾句，`Opus`也能很好的完成任務.

但是20美元的`Pro`套餐使用`Opus`的使用量只能用嚐鮮來形容，我的工作流程是`plan`->`worker`, 兩個都使用opus的情況下，一個複雜任務下去，直接能把5小時限額淦掉一般.

但是如果使用`sonnet/haiku`那麼還用啥Claude呢.

況且這A公司對國內有極其嚴格的風控.

### ChatGPT Plus

很不錯的套餐, 就是也要翻牆, 不過沒有A公司那麼嚴格.

最近`GPT-5.5`出來之後`ChatGPT Plus`就變得很不錯了，體驗不輸`Claude`.

對比`Claude Pro`體感上大概是3倍的用量.

最優先建議購買的套餐.

### Github Copilot

本來是神中神, 由於計費政策從次數改為積分後，現在變成拉中拉了.

### MiniMax

模型能力雖然一般，但是夠用。

用量極其誇張，基本是給OpenClaw之類的全能代理工具用的級別.

### Kimi

我購買的是Moderato 用量可以說是侃侃吃緊. 對我最近的編程任務來說剛剛好. 但是這個套餐肯定是不夠的.

在CC中使用，Kimi2.6模型的能力比較接近Claude sonnet 4.6.

---

下面是`Coding Agent`

### Claude Code

簡單來說就是開箱即用, `Claude Code` 內置的提示詞和agent調度很優秀，工作極少會出錯，一般都是提示詞歧義問題，才會導致出錯.

### Open Code

最嚴謹的一集，但是事多，OpenCode工作比Claude Code略慢一些，而且經常會編寫單元測試, 和執行一些奇怪的review。哪怕你沒有要求他去做.

非常推薦使用`omo(oh-my-openagent)`, 裝上這個工作流之後基本工作準確率能上升不少，就是費token.

### Codex

這個我不太好評價，因為沒有配合GPT以外的模型使用過. GPT搭配Codex效果確實非常好，體驗甚至在`Claude Code`之上.

### Pi

優點是擴展性高，缺點也是擴展性高。

有使用門檻的Agent, 本身自帶的system-prompts 極少，1M都不到，本身沒有`sub-agent`,`plan-mode`,`MCP`, 不過有一個很強的上下文管理機制 `/tree` 回到任意時間點.

Pi對上下文的可控性可以最大程序發揮LLM本身的性能，節約Token以及可以高度自定義自己的工作流。

我使用了一段時間，只不過對我來說是弊大於利。我是真不擅長調整上下文，導致在我工作中的實際表現對比`claude-code`要差上很多.
