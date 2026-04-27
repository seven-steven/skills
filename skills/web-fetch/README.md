# web-fetch

将任意 URL 转换为干净的 Markdown，供 Claude 引用、摘要、翻译或提取内容。

## 用途

访问一个 URL，依次尝试三个转换服务，返回第一个成功的 Markdown 正文。适用于：

- 用户分享链接想让你阅读内容
- 内置 `WebFetch` 被网络封锁时（返回 DNS 或超时错误）
- 页面需要通过代理才能访问（地区限制、IP 封锁）
- 需要原始页面文本而非模型摘要

## 用法

Claude 自动调用，无需手动输入命令。你也可以在终端直接运行脚本：

```bash
node scripts/fetch.mjs <url>
```

**输出格式**（stdout）：

```
<!-- web-fetch: source=r.jina.ai url=https://example.com -->
# Example Domain
This domain is for use in illustrative examples...
```

第一行是来源标注注释，其余是 Markdown 正文。

**错误输出**（stderr，退出码 1）：

```
web-fetch: all endpoints failed
  - r.jina.ai: request timeout after 30000ms
  - markdown.new: HTTP 429
  - defuddle.md: ECONNREFUSED
```

**缺少参数**（退出码 2）：

```
usage: fetch.mjs <url>
```

## 配置

### 代理（WEB_FETCH_PROXY）

在 `.claude/settings.json`（项目级）或 `~/.claude/settings.json`（全局）的 `env` 块中设置：

```json
{
  "env": {
    "WEB_FETCH_PROXY": "socks5h://127.0.0.1:1080"
  }
}
```

Claude Code 会自动将 `env` 块中的变量注入到脚本进程。

**支持的协议**：

| 协议前缀                         | 隧道方式                   | DNS 解析位置   |
| -------------------------------- | -------------------------- | -------------- |
| `http://proxy:port`              | HTTP CONNECT               | 代理侧         |
| `http://user:pass@proxy:port`    | HTTP CONNECT（Basic Auth） | 代理侧         |
| `socks5://proxy:port`            | SOCKS5（无认证）           | 客户端本地     |
| `socks5h://proxy:port`           | SOCKS5（无认证）           | 代理侧（推荐） |
| `socks5://user:pass@proxy:port`  | SOCKS5（用户名密码认证）   | 客户端本地     |
| `socks5h://user:pass@proxy:port` | SOCKS5（用户名密码认证）   | 代理侧         |

- `socks5h://` 让代理解析 DNS，避免本地 DNS 泄漏，适合透明代理场景
- SOCKS5 认证遵循 RFC 1929，密码中的特殊字符需 percent-encode（`URL` 对象解析时自动处理）
- 空字符串等同于不设置代理

**不支持**：`socks4://`、`https://`（TLS 代理）

### 超时

默认每个端点 30 秒超时，三档共最多 90 秒。当前版本不可配置。

## 示例

```bash
# 直连
node scripts/fetch.mjs https://example.com

# 通过 SOCKS5 代理（无认证）
WEB_FETCH_PROXY=socks5h://127.0.0.1:1080 node scripts/fetch.mjs https://example.com

# 通过 SOCKS5 代理（用户名密码认证）
WEB_FETCH_PROXY=socks5h://alice:s3cr3t@127.0.0.1:1080 node scripts/fetch.mjs https://example.com

# 通过 HTTP CONNECT 代理（带认证）
WEB_FETCH_PROXY=http://user:pass@proxy.example:8080 node scripts/fetch.mjs https://example.com
```

## 实现架构

```
fetch.mjs
└── tryEndpoints(url, { proxy })        # 三档瀑布式重试
    └── httpGet({ url, proxy, ... })
        ├── getDirect(...)               # 无代理：node:http/https 直连
        └── getViaProxy(...)             # 有代理：手动隧道 + 手动 HTTP/1.1
            ├── openTunnel(proxy, host, port)
            │   ├── httpConnectTunnel()  # HTTP CONNECT → raw socket
            │   └── socks5Tunnel()       # SOCKS5 二进制握手（含 RFC 1929 认证）→ raw socket
            └── requestOverSocket()      # TLS 握手（可选）+ 手写 HTTP/1.1
                └── parseHttpResponse()  # 状态行 + 头部 + chunked 解码
```

### 三档瀑布（`tryEndpoints`）

按顺序尝试三个端点：

1. `r.jina.ai/{url}` — 最稳定，适合大多数公开页面
2. `markdown.new/{url}` — 备用
3. `defuddle.md/{url}` — 最后兜底

任何端点返回 HTTP 2xx 且正文非空即视为成功，后续端点跳过。以下情况跳到下一档：抛出异常、HTTP 4xx/5xx、正文为空。

### 代理隧道为何不用 `https.request`

Node.js 的 `https.request({ agent: false, createConnection })` 文档上支持 `createConnection` 选项，但 `agent: false` 实际创建了默认 `https.Agent`，该 Agent **忽略** request options 里的 `createConnection`，自行建立新 TCP 连接直连目标 IP，绕过了隧道 socket。

因此代理路径完全绕开 `https.request`，改为：

1. `openTunnel` 建立原始 TCP 隧道 socket
2. 若目标是 HTTPS，用 `tls.connect({ socket, servername })` 在隧道上做 TLS 握手
3. 手写 HTTP/1.1 请求字符串写入 socket，强制 `Connection: close` + `Accept-Encoding: identity`
4. `parseHttpResponse` 解析原始 Buffer：状态行、头部、chunked 解码

### SOCKS5 握手流程

无认证（proxy URL 不含用户名）：

```
客户端 → 代理：05 01 00                        (NMETHODS=1, [NO_AUTH])
代理   → 客户端：05 00                          (选择 NO_AUTH)
客户端 → 代理：05 01 00 03 <len> <host> <port>  (CONNECT, ATYP=DOMAIN)
代理   → 客户端：05 00 00 <atyp> <addr> <port>  (REP=00 成功)
→ 隧道建立
```

带认证（proxy URL 含用户名，RFC 1929）：

```
客户端 → 代理：05 02 00 02                      (NMETHODS=2, [NO_AUTH, USERNAME/PASSWORD])
代理   → 客户端：05 02                          (选择 USERNAME/PASSWORD)
客户端 → 代理：01 <ulen> <user> <plen> <pass>   (子协商)
代理   → 客户端：01 00                          (认证成功)
客户端 → 代理：05 01 00 03 <len> <host> <port>  (CONNECT, ATYP=DOMAIN)
代理   → 客户端：05 00 00 <atyp> <addr> <port>  (REP=00 成功)
→ 隧道建立
```

统一使用 ATYP=DOMAIN（`0x03`），让代理端解析 DNS，对 `socks5:` 和 `socks5h:` 行为一致。

## 测试

```bash
cd skills/web-fetch && npm test
```

覆盖 29 个用例：三档瀑布逻辑（10）、真实网络 HTTP/CONNECT（5）、HTTP 响应解析（6）、SOCKS5 协议（5）、其余边界（3）。

## 限制

- **不支持 SOCKS4**
- **不支持 TLS 代理**（`https://` 代理地址）
- **SOCKS5 认证仅支持 NO_AUTH 和 USERNAME/PASSWORD**（METHOD=0x00/0x02）；GSSAPI 等其他方法不支持
- **付费墙 / 强反爬页面**：三个转换服务均无法处理时会全部失败。后续版本计划接入 Scrapling，当前未实现
- **TLS-over-tunnel 集成测试**：需要生成自签名证书，成本较高，当前测试套件不覆盖；通过 smoke test 手动验证
