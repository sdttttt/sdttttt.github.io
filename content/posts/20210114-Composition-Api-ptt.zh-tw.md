---
title: "Composition Api"
date: 2021-01-14
description: "再次結合 Vue2 項目實踐講解組合式 API 的使用方式,通過自定義函數封裝與響應式數據展示邏輯拆分思路,討論自動追蹤副作用在頁面渲染後首次執行時收集依賴從而實現自動追蹤的魔法原理與副作用機制在 Vue 中的實現細節。"
author: sdttttt
draft: false
cover:
  image: "images/covers/20210114-Composition-Api-ptt.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20210114053o1c/"]
language: "zh-tw"
---

最近一直在寫 Vue, 在公司的項目裡使用的是`Composition Api` + Vue2 的組合. _(因為公司裡考慮到同事的技能樹, 沒有用vue3和Typescipt)_.

CA 是 Vue3 追加的全新 API. 用到 Vue2 裡可能有點怪怪的.

不過 CA 是以 Vue-Plugin 的方式提供的 API, 所以使用起來非常方便.
同時也鼓勵更多人使用這個API.

首先是關於這個API的使用方式, 以前的代碼需要將方法卸載method區塊中, 每個變量和方法之間的關係很模糊曖昧.

需要開發者自己去找關於每個方法和變量之間的關係, 用CA之後可以寫出類似ReactHook風格的代碼.

```jsx
// OA (Option API 原版的API是這樣稱呼的)
{
    data: {
        count: 1
    },
    methods: {
        sub(num: number) {
            // ...
        },
        add(num: number) {
            // ...
        }
    }
}
// CA
const count = ref(1);
const { add, sub } = useCount();

add(1);
sub(2);

function useCount(count: Ref<number>) {
    function sub(num: number) {
            // ...
        },
    function add(num: number) {
        // ...
    }
}

// 當然你也可以像ReactHook那樣寫， 完全沒有問題，看你的個人口味
const { count, add, sub } = useCount(0);

add(1);
sub(2);

function useCount(count: number) {
    const count = ref(count);
    function sub(num: number) {
            // ...
        },
    function add(num: number) {
        // ...
    }
}
```

我目前寫CA大概就是這樣編寫的. 根據一個響應數據的關係編寫改變它的一系列動作.
這樣邏輯拆分的很清楚. 查看起來也比較方便.

---

不過這套API目前的缺點也比較明顯, 在開發過程中從Vue2過來的用戶很明顯能感覺到,
在`setup()`由於不能使用`this`所以會有很多開發習慣上的麻煩.

**這裡說個關於使用this上掛載對象的方法.** (ctx參數不說了)

- 首先就是CA的庫中有一個函數,叫做`getCurrentInstall`. 可以通過該函數獲得當前組件的實例. 使用該實例上代理的對象就能控制各種`this.$router`, `this.$refs`方法了.
- 第二種可以讓你使用`this`, 把動作函數掛載到某個視圖按鈕上的時候, 在該動作函數里就可以使用`this`對象. 上面有正常OA可以使用的所有`this`上掛載的對象.

開發項目的時候還踩了很多坑, 不過都是一些智商問題... 比如JS的對象傳遞傳遞的是`Reference`, 基本類型是`Clone`. 因為這個原因有幾個視圖之間的數據沒法實時同步, 害我浪費了一個下午.

###

### 關於 watchEffect

這個函數的實現和React Hook中的useEffect有異曲同工之妙,
監聽回調函數內依賴的響應式數據的變化來執行回調函數.

對,沒錯, 它能監聽函數內變化的響應數據並且自動執行回調函數! 是不是很魔法!
連反射都做不到監聽函數內依賴的外部變量.

舉個例子:

```jsx
const count = ref(0);
watchEffect(() => console.log(count));

// 當count數據發送變化的時候會執行watchEffect內的回調函數
```

還有一個watch函數也可以做到類似的操作, 不過需要手動在第一個參數指定監聽的響應式數據.
watch的原理就比較容易懂了. 指定了依賴就可以通過掛鉤子來實現監聽變化執行回調了.

問題就在watchEffect是怎麼做到不指定依賴就能知道回調內依賴了哪個響應式數據?並且自動執行的?

這個魔法的原理我想破頭也沒有想出來. 看了一些關於副作用的文章之後才開始理解這個魔法的本質.

`watch` 和 `watchEffect` 有一個區別就在於, watchEffect在頁面渲染後會首次執行一次.
這個動作就是魔法的秘密了, 執行後watchEffect就能看到那些響應式數數據收到了回調的影響.(不一定是數據的變化)
