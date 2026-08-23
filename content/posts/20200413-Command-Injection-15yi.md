---
title: "Command Injection"
date: 2020-04-13
description: "解讀 DVWA 命令注入關卡 Low、Medium、High 三個難度等級的源碼差異,演示通過與符號、分號、管道符以及重複拼接等方式繞過黑名單過濾的思路,涵蓋 Windows 與 Linux 下 shell_exec 調用 ping 命令的代碼細節,以及常見可注入的命令組合與利用注意點。"
tags: ["安全"]
draft: true
cover:
  image: "images/covers/20200413-Command-Injection-15yi.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20200413036qpe/"]
language: "zh-tw"
---

### LOW

```PHP
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

### Medium

```PHP
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

# High

```PHP
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
