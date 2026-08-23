---
title: "DVWA File upload 過關秘籍"
date: 2020-04-12
description: "逐級分析 DVWA 文件上傳四個難度源碼的過濾邏輯,介紹如何通過修改請求、00% 截斷與圖片木馬等方式繞過上傳限制。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200412-DVWA-File-upload-過關秘籍-kmz.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020041200t5kg/"]
language: "zh-tw"
---

### LOW

```php
if( isset( $_POST[ 'Upload' ] ) ) {
    // Where are we going to be writing to?
    $target_path  = DVWA_WEB_PAGE_TO_ROOT . "hackable/uploads/";
    $target_path .= basename( $_FILES[ 'uploaded' ][ 'name' ] );

    // Can we move the file to the upload folder?
    // 完全沒做過濾.
    // 上傳一個PHP文件也是可以的.
    if( !move_uploaded_file( $_FILES[ 'uploaded' ][ 'tmp_name' ], $target_path ) ) {
        // No
        echo '<pre>Your image was not uploaded.</pre>';
    }
    else {
        // Yes!
        echo "<pre>{$target_path} succesfully uploaded!</pre>";
    }
}
```

###

### Medium

```php
if( isset( $_POST[ 'Upload' ] ) ) {
    // Where are we going to be writing to?
    $target_path  = DVWA_WEB_PAGE_TO_ROOT . "hackable/uploads/";
    $target_path .= basename( $_FILES[ 'uploaded' ][ 'name' ] );

    // File information
    $uploaded_name = $_FILES[ 'uploaded' ][ 'name' ];
    $uploaded_type = $_FILES[ 'uploaded' ][ 'type' ];
    $uploaded_size = $_FILES[ 'uploaded' ][ 'size' ];

    // Is it an image?
    // // 開始做了一些過濾

    // 下面是官方對$_FILES 函數的描述
    //  [name] => MyFile.txt (comes from the browser, so treat as tainted)
    //         [type] => text/plain  (not sure where it gets this from - assume the browser, so treat as tainted)
    //         [tmp_name] => /tmp/php/php1h4j1o (could be anywhere on your system, depending on your config        settings, but the user has no control, so this isn't tainted)
    //         [error] => UPLOAD_ERR_OK  (= 0)
    //         [size] => 123   (the size in bytes)

    // 其中對name和type的description的描述都是 `treat as tainted`(被汙染的)
    // 這意味著它有可能會被修改 unsafe

    // 我們可以嘗試上傳一個PHP文件，使用一些攔截請求工具，修改即將發出的請求.
    // 來達到修改`name`中的後綴名和`type`中的媒體類型.
    if( ( $uploaded_type == "image/jpeg" || $uploaded_type == "image/png" ) &&
        ( $uploaded_size < 100000 ) ) {

        // Can we move the file to the upload folder?
        if( !move_uploaded_file( $_FILES[ 'uploaded' ][ 'tmp_name' ], $target_path ) ) {
            // No
            echo '<pre>Your image was not uploaded.</pre>';
        }
        else {
            // Yes!
            echo "<pre>{$target_path} succesfully uploaded!</pre>";
        }
    }
    else {
        // Invalid file
        echo '<pre>Your image was not uploaded. We can only accept JPEG or PNG images.</pre>';
    }
}
```

###

### High

```php
if( isset( $_POST[ 'Upload' ] ) ) {
    // Where are we going to be writing to?
    $target_path  = DVWA_WEB_PAGE_TO_ROOT . "hackable/uploads/";
    $target_path .= basename( $_FILES[ 'uploaded' ][ 'name' ] );

    // File information
    $uploaded_name = $_FILES[ 'uploaded' ][ 'name' ];
        // jpg
    $uploaded_ext  = substr( $uploaded_name, strrpos( $uploaded_name, '.' ) + 1);

    // file size
    $uploaded_size = $_FILES[ 'uploaded' ][ 'size' ];

    // tmp_name 是臨時副本的名字
    $uploaded_tmp  = $_FILES[ 'uploaded' ][ 'tmp_name' ];

    // Is it an image?
    // 和上面的比起來多個一個文件後綴名的判斷.
    // strtolower 轉小寫
    // 擴展名只要滿足jpeg,png或者jpg就行
    if( ( strtolower( $uploaded_ext ) == "jpg" || strtolower( $uploaded_ext ) == "jpeg" || strtolower( $uploaded_ext ) == "png" ) &&
        ( $uploaded_size < 100000 ) &&
        // getimagesize 獲取圖像信息
        // 這個函數保證你穿的一定得是個圖像
        // 可以用圖片木馬繞過
        getimagesize( $uploaded_tmp ) ) {

        // Can we move the file to the upload folder?
        if( !move_uploaded_file( $uploaded_tmp, $target_path ) ) {
            // No
            echo '<pre>Your image was not uploaded.</pre>';
        }
        else {
            // Yes!
            echo "<pre>{$target_path} succesfully uploaded!</pre>";
        }
    }
    else {
        // Invalid file
        echo '<pre>Your image was not uploaded. We can only accept JPEG or PNG images.</pre>';
    }
}
```

###

### High

```php
if( isset( $_POST[ 'Upload' ] ) ) {
    // Where are we going to be writing to?
    $target_path  = DVWA_WEB_PAGE_TO_ROOT . "hackable/uploads/";
    $target_path .= basename( $_FILES[ 'uploaded' ][ 'name' ] );

    // File information
    $uploaded_name = $_FILES[ 'uploaded' ][ 'name' ];
    $uploaded_ext  = substr( $uploaded_name, strrpos( $uploaded_name, '.' ) + 1);
    $uploaded_size = $_FILES[ 'uploaded' ][ 'size' ];
    $uploaded_tmp  = $_FILES[ 'uploaded' ][ 'tmp_name' ];

    // Is it an image?
    // 對比上面多驗證了文件的後綴名
    if( ( strtolower( $uploaded_ext ) == "jpg" || strtolower( $uploaded_ext ) == "jpeg" || strtolower( $uploaded_ext ) == "png" ) &&
        ( $uploaded_size < 100000 ) &&

        // 函數會通過讀取文件頭，返回圖片的長、寬等信息，如果沒有相關的圖片文件頭，函數會報錯
        getimagesize( $uploaded_tmp ) ) {

        // 可以看到，High級別的代碼讀取文件名中最後一個”.”後的字符串，期望通過文件名來限制文件類型
        // 因此要求上傳文件名形式必須是”*.jpg”、”*.jpeg” 、”*.png”之一
        // 同時，getimagesize函數更是限制了上傳文件的文件頭必須為圖像類型

        // Can we move the file to the upload folder?
        if( !move_uploaded_file( $uploaded_tmp, $target_path ) ) {
            // No
            echo '<pre>Your image was not uploaded.</pre>';
        }
        else {
            // Yes!
            echo "<pre>{$target_path} succesfully uploaded!</pre>";
        }
    }
    else {
        // Invalid file
        echo '<pre>Your image was not uploaded. We can only accept JPEG or PNG images.</pre>';
    }
}
```

###

### Impossible

```php
if( isset( $_POST[ 'Upload' ] ) ) {
    // Check Anti-CSRF token
    checkToken( $_REQUEST[ 'user_token' ], $_SESSION[ 'session_token' ], 'index.php' );

    // File information
    $uploaded_name = $_FILES[ 'uploaded' ][ 'name' ];
    $uploaded_ext  = substr( $uploaded_name, strrpos( $uploaded_name, '.' ) + 1);
    $uploaded_size = $_FILES[ 'uploaded' ][ 'size' ];
    $uploaded_type = $_FILES[ 'uploaded' ][ 'type' ];
    $uploaded_tmp  = $_FILES[ 'uploaded' ][ 'tmp_name' ];

    // Where are we going to be writing to?
    $target_path   = DVWA_WEB_PAGE_TO_ROOT . 'hackable/uploads/';
    //$target_file   = basename( $uploaded_name, '.' . $uploaded_ext ) . '-';

    // MD5 加密
    $target_file   =  md5( uniqid() . $uploaded_name ) . '.' . $uploaded_ext;
    $temp_file     = ( ( ini_get( 'upload_tmp_dir' ) == '' ) ? ( sys_get_temp_dir() ) : ( ini_get( 'upload_tmp_dir' ) ) );
    $temp_file    .= DIRECTORY_SEPARATOR . md5( uniqid() . $uploaded_name ) . '.' . $uploaded_ext;

    // Is it an image?
    if( ( strtolower( $uploaded_ext ) == 'jpg' || strtolower( $uploaded_ext ) == 'jpeg' || strtolower( $uploaded_ext ) == 'png' ) &&
        ( $uploaded_size < 100000 ) &&
        ( $uploaded_type == 'image/jpeg' || $uploaded_type == 'image/png' ) &&
        getimagesize( $uploaded_tmp ) ) {

        // Strip any metadata, by re-encoding image (Note, using php-Imagick is recommended over php-GD)
        if( $uploaded_type == 'image/jpeg' ) {
            $img = imagecreatefromjpeg( $uploaded_tmp );
            imagejpeg( $img, $temp_file, 100);
        }
        else {
            $img = imagecreatefrompng( $uploaded_tmp );
            imagepng( $img, $temp_file, 9);
        }
        imagedestroy( $img );

        // Can we move the file to the web root from the temp folder?
        if( rename( $temp_file, ( getcwd() . DIRECTORY_SEPARATOR . $target_path . $target_file ) ) ) {
            // Yes!
            echo "<pre><a href='${target_path}${target_file}'>${target_file}</a> succesfully uploaded!</pre>";
        }
        else {
            // No
            echo '<pre>Your image was not uploaded.</pre>';
        }

        // Delete any temp files
        if( file_exists( $temp_file ) )
            unlink( $temp_file );
    }
    else {
        // Invalid file
        echo '<pre>Your image was not uploaded. We can only accept JPEG or PNG images.</pre>';
    }
}

// Generate Anti-CSRF token
generateSessionToken();
```

###

### Extension

**00%截斷**

```php
$is_upload = false;
$msg = null;
if(isset($_POST['submit'])){
    // 白名單
    $ext_arr = array('jpg','png','gif');
    $file_ext = substr($_FILES['upload_file']['name'],strrpos($_FILES['upload_file']['name'],".")+1);
    if(in_array($file_ext,$ext_arr)){
        $temp_file = $_FILES['upload_file']['tmp_name'];
        // 注意這個位置
        // 最後拼接的儲存路徑，是由用戶提交上的數據來做為路徑
        $img_path = $_POST['save_path']."/".rand(10, 99).date("YmdHis").".".$file_ext;

        if(move_uploaded_file($temp_file,$img_path)){
            $is_upload = true;
        } else {
            $msg = "上傳失敗";
        }
    } else {
        $msg = "只允許上傳.jpg|.png|.gif類型文件！";
    }
}
```

代碼採用的白名單校驗，只允許上傳圖片格式，理論上這個上傳是不好繞過的。

但是後面採用保存文件的時候，是路徑拼接的形式，而路徑又是從前端獲取，所以我們可以在路徑上做手腳。

如下上傳，顯示文件路徑中有個空格，這並不是真正意義上的空格，而是%00截斷後顯示成的空格。

> 在url中%00表示ascll碼中的0 ，而ascii中0作為特殊字符保留，表示字符串結束，所以當url中出現%00時就會認為讀取已結束 (php版本要小於5.3.4，5.3.4及以上已經修復該問題)
