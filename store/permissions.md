# 权限说明（Chrome Web Store / Edge Add-ons 审核用）

逐项说明扩展申请的每个权限及原因。扩展**不使用** `<all_urls>`、`tabs`、`webRequest`、`cookies`、`scripting` 或 `nativeMessaging`。

## permissions

### `storage`
保存扩展自身的本地数据：内容库（XHS_ALL_IN_ONE）连接配置（服务器地址、用户名、账号 ID、密码、refresh token）。全部写入 `chrome.storage.local`，仅存于用户本机，不与 Google/Microsoft 账号同步，网页脚本无法读取。
（注：笔记“热门阈值”和“只显示热门”开关与油猴版本一致，保存在小红书页面的 localStorage 中，便于沿用老用户设置；不含任何账号或凭据。）

### `declarativeNetRequestWithHostAccess`
为发往小红书图片 CDN（`*.xhscdn.com`、`ci.xiaohongshu.com`）的请求设置 `Referer: https://www.xiaohongshu.com/`。小红书 CDN 会对无 Referer 的请求拒绝出图；扩展后台服务无法可靠地通过 fetch 设置 Referer，因此使用声明式规则。
**如实说明规则的作用范围**：`declarativeNetRequest` 规则在整个浏览器内生效，不仅限于本扩展发起的请求——用户在任意页面（含其它扩展）访问 `*.xhscdn.com` / `ci.xiaohongshu.com` 时，Referer 也会被改写为 `https://www.xiaohongshu.com/`（仅替换这两个主机下的 Referer，不拦截、不修改也不重定向请求内容，不影响其它任何网站）。只选择不暴露任何信息的固定 origin 值，因为 CDN 只校验 Referer 域。

## host_permissions（静态）

### `https://xhscdn.com/*` 与 `https://*.xhscdn.com/*`
读取无水印笔记封面的图像字节（sns-webpic-qc / sns-img-qc / sns-img-hw / sns-avatar-qc 等 CDN 主机）。页面内 `fetch` 会被 CDN 的跨域与防盗链策略拦截，必须由扩展后台服务读取后再交给页面（用于复制到剪贴板或下载到本地）。后台仅对这些主机、且仅针对 GET/HEAD 放行；其余一律拒绝。

### `https://*.xiaohongshu.com/*`
封面**原图对象**存储在 `ci.xiaohongshu.com`（与 CDN 不同域），无水印原图必须从这里读取。后台静态放行仅限 `ci.xiaohongshu.com` 这一个主机且仅 GET/HEAD。扩展不读取小红书任何账号数据、Cookie 或请求内容，也不发起 POST/PUT 等变更请求。

## optional_host_permissions（运行时才申请）

### `http://*/*` 与 `https://*/*`
用户自建的内容库服务器（XHS_ALL_IN_ONE）部署在局域网 IP、自定义域名或任意端口上，无法在 manifest 中静态枚举。扩展只在用户于**选项页点击「测试连接」或「保存设置」**时，通过 `chrome.permissions.request` 申请**该服务器一个来源**的授权（如 `http://192.168.1.10:8000/*`），逐来源、需用户手势触发。未授权时内容库相关功能不可用，其余功能（高亮、跳转、复制链接、复制/下载封面）完全不受影响。「清除设置」会一并撤销该服务器的授权。
若填写 `http://`（明文）地址，选项页会给出警告：密码将以明文传输，仅建议在可信局域网内使用。

## content_scripts

### `https://www.xiaohongshu.com/search_result*`
### `https://www.xiaohongshu.com/user/profile/*`
### `https://www.xiaohongshu.com/explore*`
### `https://www.xiaohongshu.com/discovery/item/*`

只在小红书网页版生效：高亮热门笔记、插入复制/下载/保存按钮、跳转控件。不在任何其他站点注入。

## 不申请的权限

不使用 `cookies`、`tabs`、`scripting`、`webRequest`、`declarativeNetRequest`（改用带主机权限的同名 WithHostAccess）、`<all_urls>` 或后台远程代码加载。
