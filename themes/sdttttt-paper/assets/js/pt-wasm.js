/* ---------------------------------------------------------------------------
 * 共享：编译并缓存 WASM Module。
 *
 * 为什么共享 Module 而不共享 Instance：
 *   wasm 里的引擎是 `static mut ENGINE` 单例。页面左下角徽标和 /particles/
 *   大画布可能同时出现在同一页，共用同一个 Instance 会互相覆盖彼此的状态。
 *   所以这里只共享「编译结果」，每个消费方各自 `new WebAssembly.Instance()`：
 *   代码只编译一次，线性内存各自独立。
 *
 * 两个必须处理的现实情况：
 *   1. 浏览器可能**根本不支持 WASM**（老浏览器 / 极端裁剪的嵌入式内核）。
 *      这里做显式能力检测并暴露 `supported`，让调用方能在**发起网络请求之前**
 *      就决定降级，而不是等一个 404/编译失败。页面上表现为：直接用真实 PNG。
 *   2. compileStreaming / instantiateStreaming 要求服务器把 .wasm 标成
 *      `application/wasm`，否则会抛错 —— 失败时退回 arrayBuffer + compile。
 * ------------------------------------------------------------------------- */
window.ptWasm = (function () {
  'use strict';

  // 显式能力检测：不能只看 `window.WebAssembly` 存不存在 ——
  // 有些环境对象在但缺 compile / instantiate。
  var supported =
    typeof window.WebAssembly === 'object' &&
    window.WebAssembly !== null &&
    typeof window.WebAssembly.compile === 'function' &&
    typeof window.WebAssembly.instantiate === 'function';

  var cache = {};

  function fetchBytes(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('wasm ' + r.status);
      return r.arrayBuffer();
    });
  }

  function compile(url) {
    if (!supported) return Promise.reject(new Error('WebAssembly unsupported'));
    // 包一层 Promise.resolve().then()：把「同步抛错」（例如某个环境没有
    // fetch，或 WebAssembly.compile 本身抛）统一变成 rejection。
    // 这样调用方只需要 .catch，不用担心冒泡成未捕获错误。
    return Promise.resolve().then(function () {
      if (!window.WebAssembly.compileStreaming) {
        return fetchBytes(url).then(function (b) {
          return window.WebAssembly.compile(b);
        });
      }
      return window.WebAssembly.compileStreaming(fetch(url)).catch(function () {
        // 常见原因：服务器没把 .wasm 标成 application/wasm
        return fetchBytes(url).then(function (b) {
          return window.WebAssembly.compile(b);
        });
      });
    });
  }

  /** 取（并缓存）编译好的 Module —— 同一 URL 只编译一次 */
  function module(url) {
    if (!cache[url]) cache[url] = compile(url);
    return cache[url];
  }

  /** 每次调用返回一个**全新的独立 instance**，直接拿到 exports */
  function instance(url) {
    return module(url).then(function (m) {
      return new window.WebAssembly.Instance(m, {}).exports;
    });
  }

  return { supported: supported, module: module, instance: instance };
})();
