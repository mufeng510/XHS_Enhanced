# 批量下载笔记图片 — 详细设计稿

> 状态：**M1 / M2 已完成并通过验证（2026-11-14）**，M3（folder 模式直存、store 文档、2.1.0 bump）未开始。M2 后已追加一个配置项「批量下载组织方式」（`xhs-enhanced:batch-layout`，notes=按笔记文件夹默认 / flat=全部平铺单层，`<序号>_<笔记id>_<文件名>`），同一套 PREF_KEYS 水合，options 页「批量下载」卡可见，`storage.onChanged` 即时生效；仅 harness/单测覆盖，未上线真机。
> 与设计稿的两处偏差（均经用户确认路径/测试验证）：
> 1. ZIP 输出改用**锚点 object URL 单文件下载**（`triggerCoverDownload` 现有路径），不再引入 `downloads` 权限——单 zip 一次手势一个文件，浏览器不会拦；`chrome.downloads` + 权限迁到 M3 folder 模式。
> 2. 隐藏标签页 fallback 未被线上触发（SW 直拉一次即中），由单测覆盖；content capture 模式已就绪。
>
> 前置结论：用户在 Chrome 已登录小红书，Edge 登录状态未知；实测 Edge **未登录**状态下，直接打开笔记详情链接可正常 SSR 看到正文与 `__INITIAL_STATE__`（仅评论区要求登录），因此两种浏览器路径均可行，设计不依赖登录态。

## 1. 目标与范围

| 项 | 内容 |
| --- | --- |
| 选择范围 | Feed 页已渲染的笔记卡片（`a[href*="/explore/"]` 等现有 `SELECTORS.noteLinks`） |
| 下载范围 | 只封面 / 只内图 / 全部（三态，存 `chrome.storage.local`） |
| 触发 | 批量栏按钮「下载已选」一键完成 |
| 产物 | 单个 `.zip`（默认）或 `XHS_Enhanced/` 子文件夹（设置可选） |
| 非目标 | 视频文件本身；直播笔记；GIF/live photo 动态图（按静态图处理）；小红书以外的来源 |

## 2. 实测结论（2026-11-13，Edge 未登录）

1. Feed `/explore` 正常渲染卡片，84 个笔记链接（未登录可浏览）。卡片 DOM：`a.cover[href="/explore/<id>?xsec_token=...&xsec_source=..."]`，封面 `img[src*="xhscdn.com"]`。
2. 点击卡片 → 弹**登录框**（未登录时不进详情）。
3. **直接访问笔记 URL 可 SSR**：响应 HTML 内联 `window.__INITIAL_STATE__={...}`，其中 `note.noteDetailMap → 第一个 entry → note` 含 `title / type / imageList[]`。
   - `type` 为 `video` 时 `imageList` 只有 1 张（即封面），图文笔记 `imageList` = 全部内图（第 1 张通常即封面）。
   - 每张图含 `urlDefault`（`sns-webpic-qc.xhscdn.com/...!nd_dft_wlteh_webp_3`）、`urlPre`、`infoList[]`（`WB_PRV` / `WB_DFT` 两个 scene）、`width/height`。
4. **匿名 `curl` 笔记 URL → HTTP 302 到 `/login`**。即不允许无 cookie 的裸拉取。SW fetch 必须 `credentials: 'include'` 且 host_permissions 覆盖 `*.xiaohongshu.com`（manifest 已满足），cookie 由浏览器同 jar 提供；SW 拿不到 SSR HTML 时回退隐藏标签页。
5. 现有封面管线已验证的结论可直接复用：`sns-webpic` 域名只给带 `!` 后缀的衍生件，**原图/主文件在 `ci.xiaohongshu.com/<object-path>`**（去掉 URL 中 `!` 后缀、去掉 `\d{12}/[0-9a-f]+/` 签名前缀后的对象 key），`?imageView2/format/jpeg` 可强制转码出可解码格式。
6. 后台 SW 已有 `fetchBytes`（base64 回传、content-length 预检、32MB 上限、静态 CDN 门只放行 xhscdn 系 GET/HEAD）与 `ci.xiaohongshu.com` 白名单；封面下载走「主文件 → jpeg 转码 → 衍生件」三步链。

## 3. 总体架构

```
Feed 卡片 ──勾选──▶ SelectionStore（内存 Map + storage.session 持久化）
                        │
                        ▼
                 批量栏（底部居中浮层）
                 「已选 N · 全选已加载 / 连续勾选 / 清空 ·
                  范围：封面|内图|全部 · [下载已选]」
                        │ chrome.runtime.sendMessage
                        ▼
                 Background SW
                 ├─ scope=cover：直接用卡片快照的封面 URL（0 次详情请求）
                 └─ scope=inner|all：逐条抓详情
                    ├─ 首选：fetch(noteUrl, credentials:'include')
                    │  → 取内联 __INITIAL_STATE__ 脚本正文
                    │  → undefined→null → JSON.parse（复用
                    │    parseInitialStateFromScriptText）
                    │  → 失败/302/无 imageList → 回退：
                    └─ chrome.tabs.create({url, active:false})
                       → 详情页 content script（capture 模式）
                       → 解析自身 DOM 脚本正文 → sendMessage 回传
                       → SW 收到后 tabs.remove
                        │ 每张图：coverUrlCandidates() 同链取字节（SW fetchBytes）
                        ▼
                 ZIP 构建（见 §6）
                        ▼
              chrome.downloads.download（单文件）
```

### 3.1 关键取舍

- **ZIP 构建位置**：首选 **content script（Feed 页）** 构建 + object URL + **单文件 anchor 下载** 或 **SW `chrome.downloads`(data URL)**。见 §3.2 待验证项。ZIP 构建器是纯函数（`buildZip(entries) -> Uint8Array`），与构建位置无关。
- 为什么不在 SW 里拼 100MB 的 data URL 就拍板：Chrome 对 `chrome.downloads` + `data:` URL 的上限与稳定性没有官方承诺（实践可用但需实测），因此设计保留 anchor 兜底路径。
- 为什么封面不抓详情：卡片 `extractCoverUrl(card)` 已有成熟实现，封面场景下 SW 详情请求是 0 收益开销；且 cover URL 时效性（签名 `xsec`）由浏览器会话保证。
- 为什么内图必须抓详情：Feed 页 DOM 只有封面，内图 URL 只存在于详情 SSR 的 `__INITIAL_STATE__` 与页面 DOM，无法从卡片推断。

### 3.2 待实测确认（M1 先验证，否则切换兜底）

| 假设 | 验证方法 | 兜底 |
| --- | --- | --- |
| SW `credentials:'include'` 能拿到详情 SSR HTML（Edge 未登录 / Chrome 登录） | M1 期间在真实浏览器各跑一遍，看是否解析出 imageList | 隐藏标签页路径（已设计） |
| `chrome.downloads.download({url: dataURL})` 可下 20–200MB 文件 | 手动构造 50MB/150MB data URL 下载 | 改 content 构建 + anchor 单文件下载（`download` 属性只接受单层文件名，Zip 名本身单层，无影响；仅「子文件夹直存」模式必须走 SW + downloads） |
| 视频笔记 `imageList.length == 1` 即封面 | M2 抓真实数据确认；若不符则按 `type` 判断 | 内图 = `imageList.slice(isVideo ? 1 : 0)` |

## 4. 选择与瀑布流（无限滚动）设计

### 4.1 数据模型

```js
// SelectionStore（content script 内一份，模块级单例）
Map<noteId, { id, link, coverUrl, title, ts }>
```

- `noteId` = `getNoteIdFromHref()`（现有纯函数）。
- 持久化：`chrome.storage.session['xhs-enhanced:batch-selected']`（≈10KB/50 条，远低于 10MB 上限），写入去抖 300ms；reload/刷新/SPA 路由后自动恢复。退出浏览器即失效（session 语义），符合「本页勾选、一键下」的心智。
- `storage.session` 不可用时（单测/低版本）退化为纯内存。

### 4.2 卡片复选框

- 位置：封面图右上角（`position:absolute; top:6px; right:6px; z-index:2147483641`），20px 圆角方块，未选=半透明白底黑勾轮廓，已选=`#ff2442` 底白 ✓；`aria-pressed` + 键盘可聚焦（Tab 序跟在卡片后）。
- 不与现有 `.xhs-enhanced-card-actions`（左上角）冲突；`renderCard()` 已有的 `ensureCardActions` 旁挂 `ensureCardCheckbox`，由现有 MutationObserver 调用路径覆盖新渲染卡片 → **瀑布流滚出来的卡自动补框、自动回显选中态**。
- 复选框点击 `stopPropagation`，不触发卡片导航。
- 只在 `isTargetRoute()` 为 true 时出现；离开目标路由时 `cleanupAll()` 一并移除。

### 4.3 批量栏（底部居中浮层）

```
已选 12 篇  [全选已加载] [连续勾选] [清空]   范围：[封面|内图|全部]   [⬇ 下载已选]
```

- 复用现有固定浮层按钮的视觉语言（`#ff2442` 主按钮、`rgba(30,30,30,.88)` 次按钮、`2147483646` z-index、`999px` 圆角）。
- 「全选已加载」：`discoverCards(document)` 全部入选；再点 = 取消已加载全选（仅移除「当前已加载且已选」，不动已翻出 DOM 的选中项）。按钮文案/状态随 selection 是否为空切换。
- **「连续勾选」**（toggle，`aria-pressed`）：开启时，之后每张被 `renderCard()` 处理的卡自动 `selection.set(id, snapshot)`；关闭即停止自动添加，**不清空已选**。解决瀑布流「滚一批、选一批」的核心痛点。状态不持久化（避免下次打开忘关、选爆全站）。
- 「清空」：`selection.clear()` + 写 session。
- 范围分段控件三态 → `storage.local['xhs-enhanced:batch-scope']`（`cover|inner|all`，默认 `all`）；options 页不重复放置（避免两处不同步），由批量栏直接写。
- 「下载已选」：空选 → toast「请先勾选笔记」；非空 → 发消息给 SW（§5.1），按钮进入 `下载中…` disabled；期间可继续勾选（新选的不计入本次）。
- 进度/结果：SW 通过 `tabs.sendMessage(feedTabId, {type:'xhs-enhanced:batch-progress', ...})` 推进度；content 渲染 toast（复用 `showCopyStatus` 样式）：`下载中 3/50…` → `完成：48 篇 192 张图片，失败 2 篇（已跳过视频 1 篇）`。

## 5. 抓取与消息协议

### 5.1 Feed → SW：发起批量任务

```js
{
  type: 'xhs-enhanced:batch-download',
  scope: 'cover' | 'inner' | 'all',
  mode: 'zip' | 'folder',          // 默认 zip（批量栏设置项）
  items: [ { id, link, coverUrl, title } ],  // title 可为空串
}
// sender.tab.id 即进度回传目标
// SW 回：{ ok:true, accepted:true }（立即，任务异步执行）
```

SW 入口同时处理现有 `FETCH_MESSAGE`，互不影响。

### 5.2 SW 任务执行（并发 2，串行图片并发 3）

对每个 item：

1. **cover 范围**：直接进入第 2 步，URL 集合 = `coverUrlCandidates(item.coverUrl)`（现有纯函数，主文件→jpeg 转码→衍生件），文件 `01_封面.<ext>`。
2. **inner/all 范围**：
   a. `fetch(item.link, {credentials:'include', redirect:'follow'})`（SW，timeout 30s）。
      - 200 且正文含 `__INITIAL_STATE__=` → 提取该 `<script>` 正文 → `parseInitialStateFromScriptText`（已有，`undefined`→null + balanced scan，已单测）→ `note.noteDetailMap` 取 `Object.values()[0].note`。
      - 非 200 / 302 到 `/login` / 无 `imageList` / parse 失败 → **回退隐藏标签页**（§5.4）。仍失败 → 记失败，继续下一个。
   b. 图片集合：`inner|all` 取 `note.imageList`（按 `note.type==='video'` 则 inner 列表为空、cover 仍取首张）；`all` = 封面位 + 内图标记区分（封面 `01_封面`，内图 `02,03…`）。同一 `objectPath` 去重（封面位 == imageList[0] 时复用）。
   c. 每张：`coverUrlCandidates(urlDefault)` 同链 + `fetchBytes`（复用，32MB 上限；个别 >32MB 单图记失败跳过）。重试 1 次（网络抖动）。
   d. 视频笔记 inner：0 内图 → 计数 "视频笔记已跳过"。
3. **非图片内容判断**：复用 `looksLikeImageBytes/sniffImageMimeFromBytes`；`!nd_*` webp/heic 主文件解码失败时退回 `?imageView2/format/jpeg` 强制转码（现有链已覆盖）。

### 5.3 进度回传（SW → Feed tab）

```js
{ type:'xhs-enhanced:batch-progress', done, total, current, phase:'fetch'|'zip'|'download'|'done', noteId }
{ type:'xhs-enhanced:batch-done', ok, saved, failed:[{id, reason}], skippedVideo, zipNames:[...] }
```

### 5.4 隐藏标签页回退

```js
const tab = await chrome.tabs.create({ url: withParam(item.link, 'xhs_enh_capture', '1'), active: false });
// 详情页 content script（现有 bundle，detail route 已 match）识别 xhs_enh_capture=1：
//   - 不做高亮/按钮渲染（capture 模式直接 return 渲染路径）
//   - location.search 含 capture 标记 → 解析 document 内联脚本（复用
//     parseInitialStateFromScriptText(getScriptTexts())）
//   - chrome.runtime.sendMessage({ type:'xhs-enhanced:note-data', requestId, note })
// SW 收到 → tabs.remove(tabId) → 继续 5.2(b)
// 30s 超时未回 → tabs.remove + 记失败
```

需要确认 `tabs.create` 后 SW 收到的消息能带 `sender.tab.id` 关联 requestId → 用 content 注入时生成的 `requestId` 串联，防串扰。不声明 `tabs` 权限（`tabs.create/remove` 不需要；不读 `tab.url`）。

## 6. ZIP 构建（纯函数）

新模块 `src/lib/zip.js`：

- `crc32(bytes) -> uint32`（IEEE 802.3，table-driven，已知向量单测：check `123456789` → `0xCBF43926`）。
- `sanitizeFileName(name) -> string`：替换 `<>:"/\|?*` 与控制字符为 `_`；首尾空格/点去掉；NFKC 归一；截断 40 字符（按码点）；中文保留。
- `buildZip(entries: [{ name, bytes }]) -> Uint8Array`：
  - local file header `0x04034b50`（version 20, flag `0x0800` UTF-8, method **0 stored**, DOS time/date = 固定值或传入 `now`）；文件数据；central directory `0x02014b50`；EOCD `0x06054b50`。
  - ≥ 4GB 不支持（ZIP64 不做，单卷 200MB 上限自然满足）。
  - `entries` 顺序即 zip 内顺序（`001_<id>_<title>/01_封面.jpg`…）。
- `splitIntoParts(entries, maxBytes) -> parts[]`：按累计字节均分为 `Math.ceil(total/200MB)` 卷，每卷 `_partK`。
- 单测：crc32 向量、空 zip、单文件、跨卷、UTF-8 文件名（用 `unzip -l` / Python `zipfile` round-trip 验证）。

**零依赖**（esbuild 打包进 content.js，增量 ~3KB）。

## 7. 产物与文件名

| 模式 | 产物 | 说明 |
| --- | --- | --- |
| zip（默认） | `XHS笔记_YYYYMMDDHHmm_<N>篇.zip`（分卷 `_partK`） | 内含 `<001>_<noteId>_<标题截断30>/01_封面.jpg` `02.jpg`…；视频笔记内图不生成 |
| folder（可选，批量栏齿轮进 options 或直接批量栏下拉） | `XHS_Enhanced/YYYYMMDDHHmm_<noteId>/01_封面.jpg …` | 逐文件 `chrome.downloads`，`conflictAction:'uniquify'`；浏览器「下载前询问」开着会逐个弹窗——UI 提示关闭该浏览器选项 |

- 默认目录 = 浏览器 Downloads；浏览器不支持通过扩展 API 指定任意绝对路径，设计上以「Downloads 子文件夹/单 zip」满足诉求，不引入 File System Access API（需额外授权、体验割裂）。
- `xhs-enhanced` 前缀统一，避免与用户其它下载散落混杂。

## 8. 权限与文档变更

| 文件 | 变更 |
| --- | --- |
| `extension/manifest.json` | `permissions` 增加 `"downloads"`（无安装警告）；不增加 `tabs`/`offscreen`；content script matches 不变 |
| `store/permissions.md`、`store/listing.md` | 说明新增 downloads 权限用途（批量导出 zip 到默认下载目录） |
| `scripts/static-check.cjs` | 权限白名单 + bundle 标记（`buildZip` 等）更新 |
| `README.md`、`AGENTS.md` | 新功能、新消息协议、ZIP 说明、坑（data URL 上限结论） |
| `options.html/js` | **不**加批量选项（scope 在批量栏直接写）；仅在「常规」增加「下载方式 zip/folder」单选 |
| `package.json` | bump `2.1.0`（M2 完成时），`description` 补批量下载 |

## 9. 测试策略

**单元（node:test + vm，沿用现有风格）**
- `crc32` 已知向量；`sanitizeFileName` 全案例；`buildZip` 结构（sig 校验、EOCD offset、UTF-8 flag）+ Python round-trip 作为离线校验脚本（不进 CI，仅本地验证记录）；`splitIntoParts` 边界（恰好 200MB、1 字节溢出）。
- `extractImageListFromHtml(htmlText)`：从真实 SSR HTML（脱敏 fixture，裁剪 ~40KB）提取 noteDetailMap → imageList；覆盖视频笔记/图文笔记/多图/单图/302 登录页/无 state 六种 fixture。
- 进度/失败统计聚合纯函数 `summarizeBatch(results)`。

**Harness（tests/browser/harness.*，iframe + fixture）**
- 勾选 → 批量栏计数；全选已加载/取消；连续勾选开后模拟新卡渲染（触发 flush）→ 自动入选；清空；复选框 `stopPropagation`（点击不触发 navigate/toast）。
- mock `fetchBytes` 返回固定假字节 → 点「下载已选」→ 断言 anchor click 次数 = 1、`download` 文件名符合模板；mock chrome.downloads（SW 路径的集成在单测层验证 `chrome.downloads.download` 参数）。
- scope 三态对 `imageList` 的过滤（视频笔记内图=0）。

**真实浏览器（手动，需用户配合或 Edge 未登录即可）**
- Edge 未登录 30 篇：scope=all，下载 zip，解压校验数量与可打开性；视频笔记跳过提示。
- Chrome 登录态同测一遍（对照）。
- 大批量 ≥50 篇：内存、SW 存活（MV3 可能休眠——任务进行中 SW 有 fetch 保活；如休眠导致中断，需 `chrome.alarms` 或顶层 `onMessage` 保活，实测确认）。
- 浏览器「下载前询问」开/关两种表现记录到 README 坑位。

**回归**：现有 `npm test`（check + unit + browser harness）全绿。

## 10. 里程碑

- **M1（封面闭环）**：SelectionStore + 复选框 + 批量栏（全选/连续/清空/scope 展示）+ 封面批量 → ZIP → downloads；`sanitize/buildZip/crc32/splitIntoParts` 单测 + harness + zip/folder 两种下载路径实测。**产出可用版本 2.1.0-beta。**
- **M2（内图）**：SW fetch 详情（含 302/解析失败识别）→ fallback 隐藏标签 capture 模式 → 内图并入 ZIP；进度 toast + 失败汇总 + 视频跳过计数；fixture 测试。
- **M3（收口）**：folder 模式 + options 下载方式开关；store 文档/permissions/privacy-policy 更新；README/AGENTS.md；bump 2.1.0；tag 与 release。

## 11. 风险与对策

| 风险 | 对策 |
| --- | --- |
| SW `fetch` 详情被登录墙/反爬拦（302 或空 imageList） | 自动回退隐藏标签页；仍失败 → 该条失败计数，批次继续；toast 提示「未登录或风控，请登录后重试」 |
| 隐藏标签页打开 50+ 个卡顿 | 并发 ≤2，用完即 `tabs.remove`；单条超时 30s |
| 单图 >32MB 或 CDN 限流 | 跳过并计数；并发 3 + 重试 1 次 |
| `data:` URL 下载上限未知 | M1 实测；超限 → anchor 兜底（zip 名单层）或分卷 |
| 大批量 SW 被 MV3 回收 | 任务消息本身唤醒 SW；长任务期间定期 `runtime.getPlatformInfo`/fetch 保活，M2 实测验证 |
| XHS 改版字段名 | 解析失败按条失败，不污染整批；fixture 随改版更新 |
| ZIP 中文名乱码 | flag `0x0800` + UTF-8 字节写入，Python round-trip 验证 |
| 误触（选爆/误下载） | 空选保护；「连续勾选」状态不持久化；Toast 显示篇数 |
| `extractCoverUrl` 拿到的卡片 URL 签名过期 | 封面场景失败率可接受（下载失败计数）；M2 后可统一改用详情 URL |

## 12. 未决问题（需评审确认）

1. ZIP 文件命名：`XHS笔记_<时间>_<N>篇.zip` vs `xhs-notes-<时间>.zip`（纯英文，兼容性好）？
2. zip 内顶层是否需要 `封面/ ` 与 `内图/` 两级目录，还是一篇一个文件夹、封面混排（`01_封面.jpg`）？——设计默认：**一篇一文件夹、封面 `01_` 命名混排**。
3. folder 模式是否本期一起做（M3），还是先只有 zip？
4. `storage.session` 中 selection 恢复后是否提示「已恢复上次的 12 篇勾选」？——倾向静默恢复 + 批量栏上显示计数即可。
5. 批量栏放底部居中 vs 右侧复用现有按钮列（顶部 88–316px 区域）？——设计倾向**底部居中**（不与 jump/settings/入库按钮堆叠）。
