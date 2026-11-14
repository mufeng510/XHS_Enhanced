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

## 批量下载笔记图片（M1/M2，2026-11-14 实测）

需求文档与设计稿：`docs/design-batch-download.md`。在 Feed 卡片注入复选框，底部居中批量栏：`已选 N · 全选已加载 · 连续勾选 · 清空 · 范围(封面|内图|全部) · 下载已选`。

- **内图来源**：SW 直拉详情页 HTML（`fetchText`，`credentials:'include'`，带 cookie）→ 内联 `__INITIAL_STATE__` 解析（`extractNoteFromInitialStateHtml`，balanced scan + 严格→`undefined`→`new Map([])` 渐进降级；**实测 XHS 序列化偶发 `"tailMap":new Map([])`，严格 JSON.parse 会挂**）。失败降级隐藏标签页（`chrome.tabs.create(active:false)` + capture 模式 content script 解析自身 DOM 回传；SW→页 用 `xhs-enhanced:collect-note` 重试轮询，用毕即 `tabs.remove`；**不加 tabs 权限**）。**实测：登录态 SW fetch 直拉一次即中，隐藏标签路径只由单测覆盖。**
- **视频笔记**：imageList 只有封面（`type='video'`）。scope=inner 时整条笔记跳过并计入 videoSkipped；scope=all 时 01_封面 = 唯一一张。
- **产物**：单个 zip（内建手写 stored-zip+CRC32 纯函数 `src/lib/zip.js`，零依赖；>200MB 自动按 200MB 分卷 `_partK`）。`XHS笔记_YYYYMMDD_HHmm_<N>篇.zip`，内含 `<001>_<noteId>_<标题截断30>/01_封面.jpg, 02.jpg…`。锚点 object URL 直下（单手势单文件，不受多文件拦截），未加 downloads 权限。
- **瀑布流**：SelectionStore（Map<noteId> + `chrome.storage.session` 持久化，`src/lib/selection.js`，键 `xhs-enhanced:batch-selected`）；新卡由 renderCard → renderCardChrome 自动补框/回显选中态。「连续勾选」开关打开时新卡自动入选（状态不持久化）。
- **scope 三态**存 `chrome.storage.local`（`xhs-enhanced:batch-scope`，PREF_KEYS 一并 hydrate/迁移）。两标签页之间不同步（设计如此，KISS）。
- **组织方式**（选项页「批量下载」卡，`xhs-enhanced:batch-layout`，同样 PREF_KEYS 路径）：`notes`=按笔记建文件夹（默认），`flat`=全部图片平铺单层（`<序号>_<笔记id>_<文件名>`，序号保持下载顺序、noteId 保唯一，无子文件夹）。运行时 `storage.onChanged` 合并进同步缓存，已打开的 feed 页即时生效；打包在 `onBatchDownload` 最后统一定名（`buildFlatEntryName`，见 zip.js）。
- **实测（Chrome 登录态）**：30 篇封面 → `XHS笔记_....zip` 11MB、全部有效 JPEG；2 篇笔记（1 单图卡 + 12 图 comic）scope=all → 13 个条目全部有效 JPEG 且结构正确；scope=inner → 仅 11 张内图（01..11）且单图笔记自动跳过。**组织方式配置项未在线上验证（用户选择跳过真机），仅 harness+单测覆盖**。
- **harness mock 增加 `responseType:'text'` 分支**（详情 HTML 夹具，卡面定位 note-detail fixture 逻辑）。测试时序无关。
- **_metadata**：Chrome 加载扩展会在 `extension/_metadata/` 写运行时缓存（已验证 check 前会失败但恢复后正常）；已被 .gitignore 覆盖，发布前务必删（static-check 会再断言）。
- 单测 `tests/unit/zip.test.cjs` + `note-detail.test.cjs`；harness 增加 `batchSelectionAndDownload` / `batchScopeModeAndInnerImages` 两个用例块。
- **`fetchBytes` 硬编码 `responseType:'arraybuffer'`**：取 HTML 必须用 `fetchText`（`remote.js` 新增）或传 URL 精确命中 mock 的库 JSON。

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
