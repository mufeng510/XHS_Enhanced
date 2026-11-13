# AGENTS.md — XHS_Enhanced（小红书网页版增强）

浏览器扩展（Chrome/Edge，Manifest V3）。由同名 Tampermonkey 油猴脚本整体迁移而来。

## 结构

- `extension/`：扩展本体（manifest.json、构建产物 content.js/options.js/background.js、options.html/css、rules.json、icons/）。**构建产物提交进仓库**，`chrome://extensions → 加载已解压的扩展` 直接选 `extension/` 即可。
- `src/`：ES modules 源码（`lib/pure.js` 纯函数、`lib/settings.js` 存储、`lib/remote.js` 后台代理、`lib/library.js` 内容库 API、`lib/cover.js` 封面管线、`lib/initial-state.js` __INITIAL_STATE__ 解析、`content/index.js` 内容脚本、`options/options.js` 选项页、`background/index.js` 后台 SW）。
- `tests/unit/`：node:test + vm 直接加载 `extension/content.js` / `extension/background.js`（不用 src，避免双份真相）；chrome.* API 全部 mock。
- `tests/browser/`：harness.html 在页面主世界注入 bundle + harness.js 断言（fixture 用 iframe 从 `tests/fixtures/` 取）。注意：**主世界 ≠ isolated world**（content script 摸不到页面 `window.__INITIAL_STATE__`），harness 里用 `api.setTestInitialState()` 注入态对象，真实页面路径走 `parseInitialStateFromScriptText`（已有单测）。
- `scripts/build.cjs`：esbuild IIFE 打包，无 minify（可读性优先）；`npm run check` 会先 build 再跑 `static-check.cjs`（manifest/权限/bundle 标记/forbidden pattern/_metadata 缺失断言）。
- `archive/`：油猴（Tampermonkey）时代的遗留物（`xhs-enhanced.user.js` v1.9.0、`greasyfork-additional-info.html`、`userscript.test.cjs`，来源 `e8ba7fc`）。**不参与构建/测试/发布**，仅供参考，确认无用途后整体删除。

## 常用命令

```bash
npm install && npm test        # check + unit + browser（Windows=PowerShell runner，其余=run-browser-tests.sh）
npm run build                  # 只打包
```

## 架构要点 / 坑

- **特权网络通道**：content script 页面 fetch 会被内容库服务器 CORS 拦截 → 所有跨域请求走 `src/background/index.js`（host_permissions 静态涵盖 `*.xhscdn.com`、`*.xiaohongshu.com`；内容库服务器地址 = optional_host_permissions，运行时由选项页按来源、用户手势授权）。后台静态门仅放行 `*.xhscdn.com` 与 `ci.xiaohongshu.com` 且仅 GET/HEAD。
- **Referer**：CDN 要 Referer，但 fetch 无法设置（被拒/被丢）→ 用 `declarativeNetRequest` 规则（`rules.json`）为这两个域名注入 `Referer: https://www.xiaohongshu.com/`。**该规则对全浏览器生效**（仅这两个主机、仅改 referer），文案必须如实说明（store/permissions.md 已说明）。当前用 `declarativeNetRequestWithHostAccess` 避免安装警告。已实测 SW fetch 会被 DNR 改写（含 WithHostAccess）。
- **__INITIAL_STATE__**：isolated world 不可见，从内联 `<script>` 文本 JSON.parse（balanced scan，`undefined`→null 降级），失败回退脚本文本正则。
- **chrome.storage 跨上下文**：content script 启动时 `ready` 一次性 hydrate 出同步缓存；`chrome.storage.onChanged` 实时合并（选项页写入后所有已打开页面即时生效）。content script 还有一层 `subscribePreferenceChanges`：THRESHOLD/FOCUS 键变化时直接 `scan()` 重渲染（实测：选项页改阈值、所有已打开页面立即重算高亮/虚化）。
- **阈值/只显示热门**：存在 `chrome.storage.local`（THRESHOLD_KEY / FOCUS_KEY），options 页可见可写，页面没有阈值浮层；按钮只剩 `⚙ 设置`（`xhs-enhanced-settings`）打开 options 页。legacy localStorage 旧键首启自动迁移。
- **SPA 路由**：isolated world 无法 hook 页面 `history.pushState`；依赖（a）MutationObserver 内容根、（b）flush() 里 `location.href` 对比、（c）popstate/hashchange/visibilitychange。增删/替换 DOM 后必须 schedule 才检测。
- **后台标签页的 rAF 被暂停**：headless/隐藏 tab 中 rAF 不触发，flush 永远等不到回调 → `schedule()` 对 `visibilityState === 'hidden'` 额外挂 `setTimeout(run, 150)` 兜底（visible tab 保持纯 rAF，harness 的 mock-rAF 计数不变）。
- **harness 的 navigate()**：在 `sandbox`（内容根）内 append+remove 一个 marker span 来模拟 SPA 导航；append 到 body 会落在 observer 根之外，永远不会触发 flush。chrome.storage mock 里带 `onChanged`（含 `removeListener`），content script 的 `subscribePreferenceChanges` 靠它做即时重渲染断言。
- **选项页**测试连接：先用临时配置验证（health → login → accounts），**验证通过才落盘**（早期版本测连会静默保存错误密码，勿回归）。
- **32MB 上限**：后台 SW 对 arrayBuffer/text 先查 content-length 再读 body（见 MAX_BODY_BYTES）。
- 单元测试跑 bundle 而非 src：改完 src 必须 `npm run build`，否则 vm 加载的还是旧产物。
