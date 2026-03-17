---
title: "RSSHub的反代配置"
date: 
author: sdttttt
tags: []
draft: false
---

为了方便做日志和限流，给RSSHub配个和好伙伴openresty(NGINX的一个支持lua的分支)写了一下反代的配置，只说一下自己写的功能吧：

- 请求头会说自己是SpringBoot应用，因为我最恶心的就是spring全家桶了。
- 请求会记录在rsshub代理等待了多久。
- rsshub查询错误的话直接返回状态码，响应体直接放空，省点流量。
- stat 给出一些简单的性能数据和热点IP

```
http {

        ##
        # Basic Settings
        ##

        sendfile on;
        tcp_nopush on;
        tcp_nodelay on;
        keepalive_timeout 65;
        types_hash_max_size 2048;
        server_tokens off;

        # server_names_hash_bucket_size 64;
        # server_name_in_redirect off;

        include /etc/nginx/mime.types;
        default_type application/octet-stream;

        ##
        # SSL Settings
        ##

        ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3; # Dropping SSLv3, ref: POODLE
        ssl_prefer_server_ciphers on;

        ##
        # Logging Settings
        ##

        access_log off;
        error_log /var/log/nginx/error.log;

        ##
        # Gzip Settings
        ##

        gzip on;

        gzip_vary on;
        # gzip_proxied any;
        gzip_comp_level 6;
        # gzip_buffers 16 8k;
        gzip_http_version 1.1;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
        gzip_min_length 1024;

        ##
        # Virtual Host Configs
        ##

        # include /etc/nginx/conf.d/*.conf;
        # include /etc/nginx/sites-enabled/*;

        lua_shared_dict rss_limit_req_store 10m;

        init_by_lua_block {
                package.path = "/etc/openresty/lua/?.lua;" .. package.path
        }

        upstream rsshub {
                server 127.0.0.1:1222 max_fails=3 fail_timeout=30s;
                keepalive 8;
        }

        server {
                listen 1200;
                listen [::]:1200;
                server_name "";

                access_by_lua_block {
                        local rtime = require "rtime"
                        rtime.start()
                }

                header_filter_by_lua_block {
                        ngx.header["Server"] = "spring-boot"

                        local rtime = require "rtime"
                        local process_time = rtime.get_duration_ms()
                        ngx.header["x-wait-for"] = process_time
                }

                log_by_lua_block {
                        local log_path = "/var/log/nginx/access.log"

                        local now = os.date("%Y-%m-%d %H:%M:%S")
                        local method = ngx.var.request_method or "-"
                        local uri = ngx.var.request_uri or "-"
                        local rt_ms = tonumber(ngx.var.request_time) * 1000
                        if not rt_ms then rt_ms = 0 end

                        local srcip = ngx.var.remote_addr or "-"
                        local dstip = ngx.var.server_addr or "-"
                        local bytes = tonumber(ngx.var.body_bytes_sent) or 0

                        -- 获取 User-Agent
                        local ua = ngx.var.http_user_agent or "-"

                        -- 构造日志
                        local log_lines = {
                                string.format("%s [%s] %s %.1fms", now, method, uri, rt_ms),
                                string.format("[%s] <=> [%s] Byte: %d", srcip, dstip, bytes),
                                ua,
                                ""  -- 空行分隔
                        }

                        -- 安全写入
                        local fp, err = io.open(log_path, "a")
                        if not fp then
                                ngx.log(ngx.ERR, "Failed to open log file: ", err)
                                return
                        end

                        for _, line in ipairs(log_lines) do
                                local ok, err = fp:write(line, "\n")
                                if not ok then
                                        ngx.log(ngx.ERR, "Failed to write log line: ", err)
                                        break
                                end
                        end
                        fp:close()
                }

                location = /stat {
                        stub_status;
                        access_log off;

                        access_by_lua_block {
                                local addr = ngx.var.remote_addr

                                if not addr:match("^10%.126%.126%.%d+$") then
                                        ngx.log(ngx.ERR, "IP not allowed: ", addr, " for /stat, redirect to @fallback")
                                        ngx.exit(503)
                                end
                        }

                        error_page 503 = @fallback;
                }

                location ~ /(telegram|twitter)/ {
                        access_by_lua_block {
                                ngx.exit(503)
                        }

                        error_page 503 = @fallback_gfw;
                }

                location / {

                        access_by_lua_block {
                                local rtime = require "rtime"
                                rtime.start()

                                local limit_req = require "resty.limit.req"
                                local lim, err = limit_req.new("rss_limit_req_store", 10, 20)
                                if not lim then
                                        ngx.log(ngx.ERR, "failed to instantiate a resty.limit.req object: ", err)
                                        ngx.exit(500)
                                end

                                local key = ngx.var.binary_remote_addr
                                local delay, err = lim:incoming(key, true)

                                if not delay then
                                        if err == "rejected" then
                                                ngx.log(ngx.WARN, "rate limited, key: ", key)
                                                ngx.exit(429)
                                        end
                                        ngx.log(ngx.ERR, "failed to limit req: ", err)
                                        ngx.exit(500)
                                end

                                if delay > 0 then
                                        ngx.sleep(delay)
                                end
                        }

                        proxy_pass http://rsshub;
                        # 代理统一用HTTP1.1
                        proxy_http_version 1.1;

                        # 传递真实客户端信息
                        proxy_set_header Host $host;
                        proxy_set_header X-Real-IP $remote_addr;
                        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                        proxy_set_header X-Forwarded-Proto $scheme;
                        # proxy_set_header X-Forwarded-Host $host;
                        proxy_set_header X-Forwarded-Port $server_port;

                        # 支持 WebSocket
                        proxy_set_header Upgrade $http_upgrade;
                        proxy_set_header Connection "upgrade";

                        # 超时设置
                        proxy_connect_timeout 60s;
                        proxy_send_timeout 60s;
                        proxy_read_timeout 60s;

                        # 错误处理
                        proxy_next_upstream error timeout;
                        proxy_intercept_errors on;
                        error_page 503 = @fallback;
                }

                location ~* \.(jpg|jpeg|gif|ico|css|js|woff|woff2|ttf|svg|eot)$ {
                        expires 1d;
                        add_header Cache-Control "public, immutable";

                        # 仍代理到后端（如果你的服务自己处理静态资源）
                        proxy_pass http://rsshub;
                        proxy_set_header Host $host;
                        proxy_set_header X-Real-IP $remote_addr;
                        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                        proxy_set_header X-Forwarded-Proto $scheme;

                        proxy_http_version 1.1;
                        proxy_pass_request_headers on;
                }

                location ~* \.(png)$ {
                        empty_gif;
                }

                location @fallback {
                        internal;
                        content_by_lua_block {
                                ngx.status = 503
                                ngx.print()
                                ngx.exit(ngx.status)
                        }
                }

                location @fallback_gfw {
                        internal;
                        content_by_lua_block {
                                ngx.status = 503
                                ngx.header["Content-Type"] = "text/plain"
                                ngx.print("we cannot access GFW site.")
                                ngx.exit(ngx.status)
                        }
                }
        }

}
```

```
-- ip_cidr.lua

local _M = {}

local bit = require "bit"

local internal_ipset = {
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16"
}

local function ip_to_num(ip)
	-- 将 IPv4 字符串（如 "192.168.1.1"）转换为 32 位整数
	local parts = {}
    for part in ip:gmatch("%d+") do  -- 提取所有数字部分（如 "192", "168"）
        table.insert(parts, tonumber(part))
    end

    if #parts ~= 4 then
    	return nil, "invalid IPv4 address: 不是有效的 IPv4 格式"
    end

    for _, p in ipairs(parts) do
        if p < 0 or p > 255 then
            return nil, "invalid IPv4 address: 八位组超出 0-255 范围"
        end
    end

    -- 计算 32 位整数（大端序）
    -- 傻瓜也能听懂的讲解：也算是帮我复习了
    -- IP地址每个位最大255 也就是 FF = 1111 1111
    -- 192.168.1.1 经过上面转成parts就是 [192, 168, 1 ,1]
    -- 现在你要把这些数字转成一个整数，当然你可以直接乘10的倍数变成19216811
    -- 但是这样子网掩码计算就比较复杂，并且乘法在计算机底层上算不上很高效率的指令
    -- 所以这里用左移，上面说了每个位最大255也就是8个1
    -- 那么最前面的192是从右数第4位那就移动 8 * 4 = 24
    -- 以此类推，最后这个32位二进制数，8位的16进制数就是ip地址
    local part1 = bit.lshift(parts[1], 24)  -- 左移 24 位
    local part2 = bit.lshift(parts[2], 16)  -- 左移 16 位
    local part3 = bit.lshift(parts[3], 8)   -- 左移 8 位
    local part4 = parts[4]                    -- 无需移位
    return bit.bor(part1, part2, part3, part4), nil  -- 按位或合并
end

function _M.match(target_ip, cidr)

	if target_ip == nil or type(target_ip) ~= "string" or target_ip == "" then
		return false, nil
	end

	local cidr_ip_str, prefix_str = cidr:match("^([^/]+)/(%d+)$")
	if not cidr_ip_str or not prefix_str then
		return false, "invalid CIDR format: 错误 = " .. cidr
	end

	local prefix = tonumber(prefix_str)
	if prefix < 0 or prefix > 32 then
        return false, "invalid prefix: 前缀长度需为 0-32 的整数"
    end

    -- 步骤 2：将 CIDR 中的 IP 转换为整数
    local cidr_ip_num, err = ip_to_num(cidr_ip_str)
	if not cidr_ip_num then
		return false, "CIDR IP error: " .. err
    end

    -- 生成掩码位
    -- 傻瓜也能听懂的讲解：
    -- 打个比方，最常用的24，32 - 24 = 8
    -- 0xFFFFFFFF << 8 = 0xFFFFFFF00
    -- 然后去掉高位，转回32位(这个是16进制，1位当4位算)
    -- 0xFFFFFF00 按照子网掩码转成可读的方式
    -- FF FF FF 00 = 255 255 255 0
    -- 如果这还听不懂，那只能是根本不知道进制之间的转换是怎么算的

    local mask = 0

   	if prefix ~= 0 then
    	mask = bit.lshift(0xFFFFFFFF, 32 - prefix)
    	mask = bit.band(mask, 0xFFFFFFFF)
    end

    -- 网段
    local cidr_network = bit.band(cidr_ip_num, mask)

    local target_ip_num, err = ip_to_num(target_ip)

    if not target_ip_num then
    	return false, "Target IP error: " .. err
    end

    local target_ip_cidr = bit.band(target_ip_num, mask)

   	print(target_ip_cidr)
    print(cidr_network)
    print(mask)

    return target_ip_cidr == cidr_network, nil
end

function _M.is_internal(target_ip)

    for _, t in ipairs(internal_ipset) do
        local ok, err = _M.match(target_ip, t)
        if ok and err == nil then return ok, err end
    end

    return false, nil
end

return _M
```

```
-- ngx_log.lua
local _M = {}

local cjson = require "cjson"

function _M.req_info()
    local log_path = "/var/log/nginx/access.log"

    local now = os.date("%Y-%m-%d %H:%M:%S")
    local method = ngx.var.request_method or "-"
    local uri = ngx.var.request_uri or "-"
    local rt_ms = tonumber(ngx.var.request_time) * 1000
    if not rt_ms then rt_ms = 0 end

    local srcip = ngx.var.remote_addr or "-"
    local dstip = ngx.var.server_addr or "-"
    local bytes = tonumber(ngx.var.body_bytes_sent) or 0

    -- 获取 User-Agent
    local ua = ngx.var.http_user_agent or "-"

    -- 构造日志
    local log_lines = {
        string.format("%s [%s] %s %.1fms", now, method, uri, rt_ms),
        string.format("[%s] <=> [%s] Byte: %d", srcip, dstip, bytes),
        ua,
        "" -- 空行分隔
    }

    -- 安全写入
    local fp, err = io.open(log_path, "a")
    if not fp then
        ngx.log(ngx.ERR, "Failed to open log file: ", err)
        return
    end

    local ok, err = pcall(function()
        for _, line in ipairs(log_lines) do
            local ok, err = fp:write(line, "\n")
            if not ok then
                    ngx.log(ngx.ERR, "Failed to write log line: ", err)
                    break
            end
        end
    end)

    fp:close()
    if not ok then ngx.log(ngx.ERR, "Logging error: ", err) end
end

return _M
```

```
-- ngx_log.lua

local _M = {}

function _M.start()
	ngx.ctx.start_time = ngx.now()
end

function _M.get_duration_ms()
	local start = ngx.ctx.start_time
	if not start then return 0 end
	return string.format("%.1fms", (ngx.now() - start) * 1000)
end

return _M

```