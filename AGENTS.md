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
npm run package                # 产出 dist/xhs-enhanced-extension-v<manifest 版本>.zip（store 上传物，stored-zip，排除 _metadata）
```

## CI / 发布自动化（2026-11-14 实测）

- `.github/workflows/ci.yml`：push 到 master 与 PR 时跑 check + 单测 + 无头 Chrome harness（ubuntu-latest 自带 google-chrome）。
- `.github/workflows/release-edge.yml`：**发布 GitHub Release 时自动更新 Edge Add-ons**（tag 去掉前导 v 后必须等于 manifest.json version，否则失败）。流程：check → 单测 → 打包 zip → `scripts/edge-publish.cjs` 调 Update REST API v1.1（上传草稿包 → 轮询上传操作 → 提交审核 → 轮询发布操作）→ 把 zip 附到 Release。
  - Secrets（GitHub repo secrets，v1.1 header 方式）：`EDGE_CLIENT_ID`（Partner Center → Publish API → Client ID）、`EDGE_API_KEY`（同页 API key）、`EDGE_PRODUCT_ID`（商品 ID，GUID）。
  - 手动触发 `workflow_dispatch`：默认 **dry_run=true**（只校验、打印将请求的内容，不调 Edge API）；可勾选 `dry_run=false` 真正提交。真实发布仍只在 `release: published` 时自动发生。
  - 发布 = 提交到 Edge 审核队列（非立即上线）。Chrome Web Store 无对应自动化（未配置 Chrome Web Store API 凭据），仍需手动上传。
  - `scripts/edge-publish.cjs` 零依赖（Node ≥18 fetch），密钥只从环境变量读、绝不打印；上传/发布两阶段分别轮询（5s 间隔，10 分钟超时），任一失败非 0 退出。
- 发布清单见 `store/checklist.md`；Edge 首次上架必须手动（API 只能更新已发布的商品），之后更新走上述流程。

## 商品详情页高清图下载（M3，2026-11-14 实测）

油猴脚本「小红书商品高清图片下载器」的扩展实现（goods-detail 页注入右侧悬浮面板，`#xhs-enhanced-goods-panel`）：

- **来源**：goods-detail 是纯 CSR（SSR 只有 `<div id="app">`，SW 直拉拿不到图），只能内容脚本现场扫描。扫描 = DOM（`img` currentSrc/src/data-*、srcset 最大候选、`<source>`、行内 `background-image`）+ 整页 `documentElement.innerHTML` 文本 URL 提取（处理 `\u002F` 转义、去掉尾随标点）。
- **过滤**（`src/lib/goods.js`）：仅 XHS CDN 主机（xhscdn.com + ci/img/qimg.xiaohongshu.com）；排除 fe-static/formula-static（JS/CSS/字体）、含 avatar/emoji/logo 的修饰图（面板内可勾选「包含修饰图」解除）、按「host + 去 `!后缀`/query 的 path」去重，保留 imageView2 宽度最大者（无 w 参数视为 4096 最高级）。
- **HD 转换**：默认 `?imageView2/2/format/png`（油猴原语义）；面板可切换「原始格式」（剥 query）/「JPEG q90」。
- **产出**：单个 zip（stored + `00_商品信息.txt` 含标题/链接/ID/时间），单 zip 走 anchor object URL 直下（不加 downloads 权限）；>200MB 按 200MB 分卷；单张图走后台 `fetchBytes`（DNR Referer 规则只覆盖 xhscdn 与 ci.xiaohongshu.com，故 fe-img-qc.xhscdn.com 主路径 OK，img/qimg.xiaohongshu.com 已加入静态 GET/HEAD 门，见下条）。
- **生命周期**：`flush()` 里 `syncGoodsPanel(route)` 按路由创建/销毁（SPA 回退会移除面板）；面板内自带 MutationObserver（1.2s 去抖）跟随懒加载自动重扫，另有 800ms 首扫；Destroy 时断开 observer 并移除面板。
- 与笔记功能互不干扰：goods-detail 路由 `isTargetRoute()` 为 false，笔记高亮/批量/入库全部不运行；面板样式复用 content.js 注入的全局 style。
- 单测 `tests/unit/goods.test.cjs`（vm 加载 content.js 的 test seam 纯函数）；harness 增加 `goodsDetailDownload` 用例（面板渲染/扫描过滤/修饰图开关/下载完成/离开路由移除）。
- **已知边界**：goods-detail 未经真机验证（Chrome/Edge 登录态页面是否 SSR 出图未知；CSR 页面必须可执行 JS）；img/qimg.xiaohongshu.com 若校验 Referer 仍可能 403（DNR 未扩展到这两个主机，约束：static-check 断言恰好两条规则）。

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

- **特权网络通道**：content script 页面 fetch 会被内容库服务器 CORS 拦截 → 所有跨域请求走 `src/background/index.js`（host_permissions 静态涵盖 `*.xhscdn.com`、`*.xiaohongshu.com`；内容库服务器地址 = optional_host_permissions，运行时由选项页按来源、用户手势授权）。后台静态门仅放行 `*.xhscdn.com` 与 `ci.xiaohongshu.com`（另含仅 GET/HEAD 的 `img.xiaohongshu.com`、`qimg.xiaohongshu.com` 商品图 CDN，2026-11-14 为商品图功能加入）。
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
