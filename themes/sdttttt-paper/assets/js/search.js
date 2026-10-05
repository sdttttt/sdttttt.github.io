/* ---------------------------------------------------------------------------
 * 站内搜索 —— /search/ 页面用
 * （布局 themes/sdttttt-paper/layouts/_default/search.html）。
 *
 * 索引是构建期生成的 /searchindex.json
 * （themes/sdttttt-paper/layouts/index.json + hugo.toml 的 JSON 输出格式），
 * 只在访客第一次输入关键词时才请求，之后缓存在内存里。
 *
 * 匹配：查询按空白切成若干词（中文没有空格，整串算一个词），逐词在
 * 标题(10) / 标签(5) / 日期(4) / 摘要(3) / 正文(1) 里做子串匹配，同分时
 * 新的在前。默认 AND（每个词都要出现）；一条结果都没有时退化成 OR，
 * 并在状态行里说明这是部分匹配。
 *
 * 渲染一律用 DOM 节点 + textContent（不拼 innerHTML），所以索引里的
 * 任何字符都不可能变成 HTML。
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var cfgEl = document.getElementById('search-config');
  var inputEl = document.getElementById('search-input');
  var listEl = document.getElementById('search-results');
  var statusEl = document.getElementById('search-status');
  if (!cfgEl || !inputEl || !listEl || !statusEl) return; // 页面结构变了就安静退出

  var CFG = JSON.parse(cfgEl.textContent);
  var LIMIT = CFG.limit || 80;
  var indexPromise = null;
  var timer = 0;
  var results = []; // 当前渲染出来的条目，供键盘上下选
  var active = -1;

  function loadIndex() {
    if (!indexPromise) {
      var p = fetch(CFG.index, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
      // 失败后允许重试：不要把 rejected 的 promise 留在缓存里
      p.catch(function () {
        indexPromise = null;
      });
      indexPromise = p;
    }
    return indexPromise;
  }

  function tokens(q) {
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(function (t) {
        return t.length > 0;
      });
  }

  /** 命中得分；0 = 不算命中。strict = 要求每个词都出现 */
  function score(page, words, strict) {
    var title = (page.title || '').toLowerCase();
    var tags = (page.tags || []).join(' ').toLowerCase();
    var date = page.date || '';
    var summary = (page.summary || '').toLowerCase();
    var body = (page.body || '').toLowerCase();
    var total = 0;
    var found = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var hit = 0;
      if (title.indexOf(w) > -1) hit += 10;
      if (tags.indexOf(w) > -1) hit += 5;
      if (date.indexOf(w) > -1) hit += 4;
      if (summary.indexOf(w) > -1) hit += 3;
      if (body.indexOf(w) > -1) hit += 1;
      if (hit > 0) {
        found++;
        total += hit;
      }
    }
    if (found === 0) return 0;
    if (strict && found !== words.length) return 0;
    return total;
  }

  function rank(all, words, strict) {
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var s = score(all[i], words, strict);
      if (s > 0) hits.push({ page: all[i], score: s });
    }
    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.page.date < b.page.date ? 1 : -1; // 同分时新的在前
    });
    return hits.map(function (h) {
      return h.page;
    });
  }

  function firstHit(text, words) {
    var low = text.toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var at = low.indexOf(words[i]);
      if (at > -1) return at;
    }
    return -1;
  }

  /** 命中处附近的片段：优先摘要，其次正文 */
  function snippet(page, words) {
    var src = page.summary || '';
    var at = firstHit(src, words);
    if (at < 0) {
      src = page.body || '';
      at = firstHit(src, words);
    }
    if (at < 0) at = 0;
    var from = Math.max(0, at - 40);
    var to = Math.min(src.length, at + 120);
    return (from > 0 ? '…' : '') + src.slice(from, to) + (to < src.length ? '…' : '');
  }

  /** 把命中的词包进 <mark>：先合并重叠区间，再逐段拼 DOM */
  function highlight(text, words) {
    var frag = document.createDocumentFragment();
    var low = text.toLowerCase();
    var spans = [];
    // 大小写折叠改变了长度（某些特殊字符）就整段不高亮，避免切错位置
    if (low.length === text.length) {
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var from = 0;
        var at;
        while (w && (at = low.indexOf(w, from)) > -1) {
          spans.push([at, at + w.length]);
          from = at + w.length;
        }
      }
    }
    if (!spans.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    spans.sort(function (a, b) {
      return a[0] - b[0] || a[1] - b[1];
    });
    var merged = [spans[0]];
    for (var j = 1; j < spans.length; j++) {
      var last = merged[merged.length - 1];
      if (spans[j][0] <= last[1]) last[1] = Math.max(last[1], spans[j][1]);
      else merged.push(spans[j]);
    }
    var pos = 0;
    merged.forEach(function (span) {
      if (span[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, span[0])));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(span[0], span[1]);
      frag.appendChild(mark);
      pos = span[1];
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }

  function setActive(next) {
    var items = listEl.children;
    if (active > -1 && items[active]) items[active].classList.remove('is-active');
    active = next;
    if (active > -1 && items[active]) {
      items[active].classList.add('is-active');
      items[active].scrollIntoView({ block: 'nearest' });
    }
  }

  function render(list, words) {
    results = list;
    active = -1;
    listEl.textContent = '';
    list.forEach(function (page) {
      var li = document.createElement('li');
      li.className = 'search__item';

      var link = document.createElement('a');
      link.className = 'search__link';
      link.href = page.url;

      var title = document.createElement('span');
      title.className = 'search__item-title';
      title.appendChild(highlight(page.title || '', words));

      var meta = document.createElement('span');
      meta.className = 'search__item-meta';
      // 日期和标签也参与匹配（权重还不低），命中的部分要看得出来
      meta.appendChild(highlight(page.date || '', words));
      (page.tags || []).forEach(function (tag) {
        meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(highlight(tag, words));
      });

      var text = document.createElement('span');
      text.className = 'search__item-snippet';
      text.appendChild(highlight(snippet(page, words), words));

      link.appendChild(title);
      link.appendChild(meta);
      link.appendChild(text);
      li.appendChild(link);
      listEl.appendChild(li);
    });
  }

  function idle() {
    render([], []);
    statusEl.textContent = CFG.total + ' 篇文章，输入关键词开始搜索';
  }

  function run(q) {
    q = q.trim();
    window.history.replaceState(null, '', q ? '?q=' + encodeURIComponent(q) : window.location.pathname);
    if (!q) {
      idle();
      return;
    }
    var words = tokens(q);
    if (!indexPromise) statusEl.textContent = '正在载入索引…';
    loadIndex()
      .then(function (all) {
        var hits = rank(all, words, true);
        var note = '';
        if (!hits.length && words.length > 1) {
          hits = rank(all, words, false);
          note = '（没有同时包含这些词的文章，以下为部分匹配）';
        }
        var shown = hits.slice(0, LIMIT);
        render(shown, words);
        if (!hits.length) {
          statusEl.textContent = '没有找到匹配的文章';
        } else {
          statusEl.textContent =
            '找到 ' +
            hits.length +
            ' 篇' +
            (hits.length > shown.length ? '（只显示前 ' + LIMIT + ' 篇）' : '') +
            note;
        }
      })
      .catch(function (err) {
        render([], []);
        statusEl.textContent = '索引载入失败：' + err.message;
      });
  }

  inputEl.addEventListener('input', function () {
    window.clearTimeout(timer);
    var value = inputEl.value;
    timer = window.setTimeout(function () {
      run(value);
    }, 120);
  });

  inputEl.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      var next = active + (event.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) next = results.length - 1;
      if (next >= results.length) next = 0;
      setActive(next);
    } else if (event.key === 'Enter') {
      var item = listEl.children[active > -1 ? active : 0];
      var link = item && item.querySelector('a');
      if (link) {
        event.preventDefault();
        window.location.href = link.getAttribute('href');
      }
    } else if (event.key === 'Escape') {
      inputEl.value = '';
      run('');
    }
  });

  var initial = new URLSearchParams(window.location.search).get('q');
  if (initial) {
    inputEl.value = initial;
    run(initial);
  } else {
    idle();
  }
})();
