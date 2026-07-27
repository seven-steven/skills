# web-fetch

将 URL 通过 Markdown 转换服务获取为可审计的原始 Markdown。该技能只适用于以下情形：需要带来源标签的原始 Markdown、内建 `WebFetch` 已被网络阻断或失败、或用户明确要求代理/三段回退链。普通阅读、摘要、翻译或提取任务应优先使用内建 `WebFetch`。

## 用途

脚本固定按以下顺序请求服务：

1. `r.jina.ai`
2. `markdown.new`
3. `defuddle.md`

某一服务返回非空 HTTP 2xx 正文即停止并输出；超时、连接异常、HTTP 4xx/5xx 或空正文都会进入下一档。输出的首行记录实际成功的服务，便于复核原始内容来源。

## 用法

Claude 在满足触发条件时自动调用。也可在终端直接执行：

```bash
node scripts/fetch.mjs <url>
```

参数必须是绝对 `http://` 或 `https://` URL。

成功时 stdout 为：

```markdown
<!-- web-fetch: source=r.jina.ai url=https://example.com -->

# Example Domain

This domain is for use in illustrative examples...
```

第一行是来源标签，后续为转换服务返回的 Markdown 正文。脚本会补齐末尾换行。

所有服务失败时，stderr 会列出各服务的原因并以退出码 1 结束：

```text
web-fetch: all endpoints failed
  - r.jina.ai: request timeout after 30000ms
  - markdown.new: HTTP 429
  - defuddle.md: connect refused: ECONNREFUSED
```

缺少 URL 或 URL 不合法时以退出码 2 结束：

```text
usage: fetch.mjs <url>
web-fetch: invalid URL: Invalid URL
```

## 配置

### 代理：`WEB_FETCH_PROXY`

在项目 `.claude/settings.json` 或全局 `~/.claude/settings.json` 的 `env` 中配置：

```json
{
  "env": {
    "WEB_FETCH_PROXY": "socks5h://127.0.0.1:1080"
  }
}
```

Claude Code 会将该环境变量传入脚本。空字符串等同于不使用代理。

| 代理 URL                         | 隧道方式                 | 目标 DNS 解析位置 |
| -------------------------------- | ------------------------ | ----------------- |
| `http://proxy:port`              | HTTP CONNECT             | 代理侧            |
| `http://user:pass@proxy:port`    | HTTP CONNECT，Basic 认证 | 代理侧            |
| `socks5://proxy:port`            | SOCKS5                   | 本地              |
| `socks5h://proxy:port`           | SOCKS5                   | 代理侧            |
| `socks5://user:pass@proxy:port`  | SOCKS5，RFC 1929 认证    | 本地              |
| `socks5h://user:pass@proxy:port` | SOCKS5，RFC 1929 认证    | 代理侧            |

`SOCKS5` 的两个 DNS 语义不同：

- `socks5://` 在本地解析目标主机名，并在 CONNECT 请求中按解析结果发送 IPv4 `ATYP=0x01` 或 IPv6 `ATYP=0x04`。
- `socks5h://` 不做本地目标 DNS 查询，而是发送域名 `ATYP=0x03`，由代理解析，避免本地 DNS 泄漏。

用户名、密码中的保留字符应 percent-encode。暂不支持 `socks4://` 和 `https://` 代理 URL。

### 超时

每个回退端点的默认超时为 30 秒，三档均失败时最多约 90 秒。当前命令行不提供超时参数。

## 示例

```bash
# 直连
node scripts/fetch.mjs https://example.com

# 由代理端解析 DNS 的 SOCKS5（推荐用于需要避免本地 DNS 查询的场景）
WEB_FETCH_PROXY=socks5h://127.0.0.1:1080 node scripts/fetch.mjs https://example.com

# 本地 DNS 解析后，通过 SOCKS5 发送 IP 地址
WEB_FETCH_PROXY=socks5://127.0.0.1:1080 node scripts/fetch.mjs https://example.com

# SOCKS5 用户名密码认证
WEB_FETCH_PROXY=socks5h://alice:s3cr3t@127.0.0.1:1080 node scripts/fetch.mjs https://example.com

# HTTP CONNECT 代理认证
WEB_FETCH_PROXY=http://user:pass@proxy.example:8080 node scripts/fetch.mjs https://example.com
```

## 实现架构

```text
fetch.mjs
└── tryEndpoints(url, { proxy })
    ├── 校验 HTTP(S) URL
    └── r.jina.ai → markdown.new → defuddle.md
        └── httpGet({ url, proxy, ... })
            ├── getDirect()：Node 内建 http/https 请求
            └── getViaProxy()：原始隧道 + 手写 HTTP/1.1
                ├── HTTP CONNECT
                └── SOCKS5
                    ├── socks5：可注入 DNS 查询，IPv4/IPv6 ATYP
                    └── socks5h：域名 ATYP，由代理 DNS
```

代理路径先建立原始 TCP 隧道；HTTPS 目标再在该 socket 上执行 `tls.connect`。随后发送 `Connection: close`、`Accept-Encoding: identity` 的 HTTP/1.1 请求，并解析状态行、响应头和 chunked 响应，避免 Node 默认 Agent 绕过已建立隧道。

## 测试

```bash
cd skills/web-fetch
npm test
```

测试覆盖：回退顺序和成功/失败条件、无效 URL、直连与 CONNECT 代理、HTTP 响应解析、SOCKS5 认证、可注入 DNS 的成功/失败路径、IPv4/IPv6 `ATYP`、以及 `socks5h` 的代理侧域名解析。

## 限制

- 不支持 SOCKS4 和 TLS 代理。
- SOCKS5 仅支持无认证与用户名/密码认证；不支持 GSSAPI 等认证方法。
- 三个转换服务都无法绕过付费墙、强反爬或需登录页面。
- 每档超时固定为 30 秒，不能在 CLI 参数中单独调整。
