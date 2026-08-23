---
title: "Protubuf 原理"
date: 2020-03-30
description: "結合示例解析 Protobuf 按 TLV 格式序列化時 Key 的編碼方式,說明域號大小對應字節數的影響。"
draft: false
tags: ["學習"]
cover:
  image: "images/covers/20200330-Protubuf-原理-sdh.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020033005lryr/"]
language: "zh-tw"
---

protobuf 的 message 中有很多字段,每個字段的格式為:
修飾符 字段類型 字段名 = 域號;
在序列化時,protobuf 按照 TLV 的格式序列化每一個字段,T 即 Tag,也叫 Key;V 是該字段對應的值 v
省略。
序列化後的 Value 是按原樣保存到字符串或者文件中,Key 按照一定的轉換條件保存起來,序列化後的
message 中字段後面的域號與字段類型來轉換。轉換公式如下:

> (field_number << 3) | wire_type

wire_type 與類型的對應關係表:

| wire_type | meaning |
| --------- | ------------- | --------------------------------------------------------- |
| 0 | Vaint | int32、int64、uint32、uint64、sint32、sint64、bool、enum |
| 1 | 64-bit | fixed、sfixed64、double |
| 2 | Length-delimi | string、bytes、embedded、messages、packed repeated fields |
| 3 | Start group | Groups(deprecated) |
| 4 | End group | Groups(deprecated) |
| 5 | 32-bit | fixed32、sfixed32、float |

> As you can see, each field in the message definition has a unique numbered tag. These tags are used to identify your fields in the message binary format, and should not be changed once your message type is in use. Note that tags with values in the range 1 through 15 take one byte to encode. Tags in the range 16 through 2047 take two bytes. So you should reserve the tags 1 through 15 for very frequently occurring message elements. Remember to leave some room for frequently occurring elements that might be added in the future.

上面一段話是來自 Google Protobuf Documents，上面有幾個信息需要注意的地方：
protobuf 協議使用二進制格式表示 Key 字段；對 value 而言，不同的類型採用的編碼方式也不同，如果是整型，採用二進制表示；如果是字符，會直接原樣寫入文件或者字符串（即不編碼）。由於剛開始接觸 protobuf 協議，我也在學習中，下面我會給出一個例子，對於其他一些類型的編碼方式，可以仿照這個例子自己實驗一下。
**（這個例子主要是講述 Key 的編碼方式）**

上面說過，對於 message 中的每一個域，都對應一個域號。protobuf 規定：

- 如果域號在[1，15]範圍內，會使用一個字節表示 Key；
- 如果域號大於等於 16，會使用兩個字節表示 Key；

Key 編碼過後，該字節的第一個比特位表示之後的一個字節是否與當前這個字節有關:

- 如果第一個比特位為 1，表示有關，即連續兩個字節都是 Key 的編碼；
- 如果第一個比特位為 0，表示 Key 的編碼只有當前一個字節，後面的字節是 Length 或者 Value；

> 結合公式 （field_number << 3）| wire_type ，如果域號大於等於 16，兩個字節共 16 位，去掉移位的 3 位，去掉兩個字節中第一個比特位，總共 16 個比特位只有 16-5==11 個比特位用來表示 Key，所以 Key 的域號要小於 2^11== 2048

## Protobuf Example

```proto
message Person {
    required string id = 1;
    required name = 2;
    required addr = 3;

    required test = 1000;
}
```

使用 protoc 編譯後，生成兩個文件：

```sh
protoc -I=. –cpp_out=. person.proto
```

建立一個 Person 對象: 屬性為

```
id = 111

name = China

addr = Asia

test = ttttt

# 打印出序列化後的結果為：

'\n\003\061\061\061\022\005China\032\004\Asia\302\005ttttt'

```

‘\n’是 id 字段的 Key，後面的\003（八進制）表示 id 字段的值長度為 3

**key 的域號不超過 15 的序列化解析：**

因為 id 字段的域號為 1，是小於 15 的，所以 id 字段的 Key 序列化要佔 1 個字節的空間，00000001 左移 3 位變成 00001000，因為 string 的 wire_type 值是 2，所以 00001000 再或上 2，變成 00001010，就是十進制的 10，即字符’\n’。下面的字段如果域號不超過 15，解析同 id 字段。
後面連續 3 個’\61’（八進制）即字符’1’；
同樣\022\005 是 name 字段的 key 和 value 長度，後面是 name 字段的值；
\032\004 是 addr 字段的 key 和 value 長度；

最後，\302>\005 是 test 字段的 Key 和 Value 長度；

**key 的域號大於 15 的序列化解析：**

由於 CSDN 編輯器不支持 CSS 格式，沒有辦法標記下面的解析內容的顏色，只有放一個圖片上去了 ^\_^;
下面圖片中的\76 就是\302 後面的‘>’字符的八進制表示，\302 與>共同組成最後一個字段的 Key 的表示（因為最後一個字段 test 的域號 1000 大於 15，所以需要佔兩個字節表示 Key）

![](../../protobuf_1.jpg)
