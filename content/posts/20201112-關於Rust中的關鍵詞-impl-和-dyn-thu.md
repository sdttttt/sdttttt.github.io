---
title: "關於Rust中的關鍵詞: impl 和 dyn"
date: 2020-11-12
description: "用示例代碼對比 Rust 中兩個關鍵字的語義差異,說明動態分發修飾的類型會在程序執行期動態調用並帶來一定的運行時開銷,而實現語法糖在入參位置是泛型參數的簡寫、不能直接用於多種返回類型的函數,並討論包裝指針的必要性。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20201112-關於Rust中的關鍵詞-impl-和-dyn-thu.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020111200jhq0/"]
language: "zh-tw"
---

我們先來看這樣一段代碼:

```rust
impl View for Button { ... }

impl View for Text { ... }
```

我們看到`Button`和`Text`都實現了`View`屬性, 抽象是一種不錯的設計程序的方法, 幫助我們透明化的使用外部提供的API. 然後我們可能會下意識的寫出下面的代碼:

```rust
/// 這種代碼實際上會讓人感到疑惑. View究竟是個特性還是一個對象.
/// 這裡的View是一個類型, 所以我們需要寫成 `impl View`.
/// 不過`impl View` 不能用於多個trait實現的返回. 但是可以作為入參.
pub fn something() -> View {
    if ... {
        Button { ... }
    } else {
        Text { ... }
    }
}
```

這段代碼無法通過編譯, 原因就是返回值`View`需要在編譯器確認大小. 我們需要把它裝成一個胖指針.

```rust
pub fn something() -> Box<View> {...}
```

嗯,這樣就好很多. 但是編譯器會爆種, 提出一個警告, 希望你把`Box<View>`改為`Box<dyn View>`.

這又是什麼意思?

`dyn` 是動態的縮寫, 意義其實很明顯. 使用`dyn`修飾的類型, 會在程序執行期動態分發. 會有一定的RUNTIME開銷.

```rust
pub fn something() -> Box<dyn View> {...}
```

現在我們把代碼改成這樣, 好多了.

接下來說說`impl`, 這個語法是個語法糖其實.怎麼個語法糖呢?

```rust
fn something<T: View>(v: T) { ... }

// ------------- 用 impl 之後 ------------------

fn something(v: impl View) { ... }
```

真的就這麼簡單.

第二次說一遍, 這種`T(泛型)`寫法在入參可以這麼做, 但是返回值不行. 除非你的返回值只返回一個`T`實現. 兩種以上請`重載 (我亂說的,rust可能不支持)`或者使用`dyn`.
