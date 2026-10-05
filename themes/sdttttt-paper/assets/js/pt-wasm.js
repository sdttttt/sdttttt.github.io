/* ---------------------------------------------------------------------------
 * 共享：编译并缓存 WASM Module。
 *
 * 为什么共享 Module 而不共享 Instance：
 *   wasm 里的引擎是 `static mut ENGINE` 单例。页面左下角徽标和 /particles/
 *   大画布可能同时出现在同一页，共用同一个 Instance 会互相覆盖彼此的状态。
 *   所以这里只共享「编译结果」，每个消费方各自 `new WebAssembly.Instance()`：
 *   代码只编译一次，线性内存各自独立。
 *
 * 另一个坑：compileStreaming / instantiateStreaming 要求服务器把 .wasm
 * 标成 `application/wasm`，否则会抛错。这里失败时退回 arrayBuffer + compile。
 * ------------------------------------------------------------------------- */
window.ptWasm = (function () {
  'use strict';

  var cache = {};

  function fetchBytes(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('wasm ' + r.status);
      return r.arrayBuffer();
    });
  }

  function compile(url) {
    if (!window.WebAssembly) return Promise.reject(new Error('no wasm'));
    if (!WebAssembly.compileStreaming) {
      return fetchBytes(url).then(function (b) {
        return WebAssembly.compile(b);
      });
    }
    return WebAssembly.compileStreaming(fetch(url)).catch(function () {
      return fetchBytes(url).then(function (b) {
        return WebAssembly.compile(b);
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
      return new WebAssembly.Instance(m, {}).exports;
    });
  }

  return { module: module, instance: instance };
})();
