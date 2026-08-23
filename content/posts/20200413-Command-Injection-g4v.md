---
title: "Command Injection"
date: 2020-04-13
description: "解读 DVWA 命令注入关卡 Low、Medium、High 三个难度等级的源码差异,演示通过与符号、分号、管道符以及重复拼接等方式绕过黑名单过滤的思路,涵盖 Windows 与 Linux 下 shell_exec 调用 ping 命令的代码细节,以及常见可注入的命令组合与利用注意点。"
tags: ["安全"]
draft: true
cover:
  image: "images/covers/20200413-Command-Injection-g4v.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20200413036qpe/"]
---

### LOW

```PHP
if( isset( $_POST[ 'Submit' ]  ) ) {
    // Get input
    $target = $_REQUEST[ 'ip' ];

    // 没有任何过滤
    // 直接运行 ping $param

    // 可以尝试运行各种奇怪的命令组合
    // 输入 localhost && ls

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
    // 黑名单式过滤
    $substitutions = array(
        '&&' => '',
        ';'  => '',
    );

    // 然而过滤的并不严谨
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

    // 过滤的更猛了
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

    // 然而只过滤一遍
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
