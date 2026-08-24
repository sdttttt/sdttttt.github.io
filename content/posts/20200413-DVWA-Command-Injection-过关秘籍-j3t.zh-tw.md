---
title: "DVWA Command Injection 過關秘籍"
date: 2020-04-13
description: "對照 DVWA 命令注入 Low、Medium、High 三檔源碼,指出 Medium 僅過濾與符號與分號的不足、High 僅做一輪字符串替換過濾的弱點,給出每檔可用的繞過命令組合與 payload 構造技巧,並討論實際利用時需要注意的注入點細節與編碼繞過思路。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200413-DVWA-Command-Injection-過關秘籍-j3t.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020041303rv5p/"]
language: "zh-tw"
---

### LOW

```php
if( isset( $_POST[ 'Submit' ]  ) ) {
    // Get input
    $target = $_REQUEST[ 'ip' ];

    // 沒有任何過濾
    // 直接運行 ping $param

    // 可以嘗試運行各種奇怪的命令組合
    // 輸入 localhost && ls

    // Determine OS and execute the ping command.
    if( stristr( php_uname( 's' ), 'Windows NT' ) ) {
        // Windows
        $cmd = shell_exec( 'ping  ' . $target );
    }
    else {
        // *nix
        $cmd = shell_exec( 'ping  -c 4 ' . $target );
    }

    // Feedback for the end user
    echo "<pre>{$cmd}</pre>";
}
```

###

### Medium

```php
if( isset( $_POST[ 'Submit' ]  ) ) {
    // Get input
    $target = $_REQUEST[ 'ip' ];

    // Set blacklist
    // 黑名單式過濾
    $substitutions = array(
        '&&' => '',
        ';'  => '',
    );

    // 然而過濾的並不嚴謹
    // 使用 localHost &&& ls
    // 或者管道?(Linux)
    // localhost | ls`

    // Remove any of the charactars in the array (blacklist).
    $target = str_replace( array_keys( $substitutions ), $substitutions, $target );

    // Determine OS and execute the ping command.
    if( stristr( php_uname( 's' ), 'Windows NT' ) ) {
        // Windows
        $cmd = shell_exec( 'ping  ' . $target );
    }
    else {
        // *nix
        $cmd = shell_exec( 'ping  -c 4 ' . $target );
    }

    // Feedback for the end user
    echo "<pre>{$cmd}</pre>";
}
```

#

# High

```php
if( isset( $_POST[ 'Submit' ]  ) ) {
    // Get input
    $target = trim($_REQUEST[ 'ip' ]);

    // 過濾的更猛了
    // Set blacklist
    $substitutions = array(
        '&'  => '',
        ';'  => '',
        '| ' => '',
        '-'  => '',
        '$'  => '',
        '('  => '',
        ')'  => '',
        '`'  => '',
        '||' => '',
    );

    // 然而只過濾一遍
    // localhost ||||

    // Remove any of the charactars in the array (blacklist).
    $target = str_replace( array_keys( $substitutions ), $substitutions, $target );

    // Determine OS and execute the ping command.
    if( stristr( php_uname( 's' ), 'Windows NT' ) ) {
        // Windows
        $cmd = shell_exec( 'ping  ' . $target );
    }
    else {
        // *nix
        $cmd = shell_exec( 'ping  -c 4 ' . $target );
    }

    // Feedback for the end user
    echo "<pre>{$cmd}</pre>";
}
```
