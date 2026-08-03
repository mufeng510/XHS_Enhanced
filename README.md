# 小红书网页版增强

一个零运行时依赖、单文件的 Tampermonkey 用户脚本，用于在小红书网页版快速识别热门笔记。

## 功能

- 在搜索结果页和用户主页中，高亮点赞数**严格大于所设阈值**的笔记卡片；
- 右上角可设置热门阈值，默认 `100`；设置保存在当前浏览器本地，更新后立即重新高亮；
- 同时高亮卡片内的点赞数；
- 页面右上角提供“下一条热门笔记”悬浮按钮，跳过当前可见内容并平滑滚动到下方最近的热门笔记；
- 没有下一条热门笔记时滚动到页面底部并提示，后续动态加载热门笔记后仍可继续跳转；
- 自动处理首屏内容、无限滚动新增内容、属性更新和站内 SPA 导航；
- 不展示或推断笔记发布时间。

## 安装

### 方式一：通过 Greasy Fork 安装（推荐）
1. 在桌面版 Chrome 或 Edge 中安装 Tampermonkey。
2. 访问 [Greasy Fork 脚本页面](https://greasyfork.org/zh-CN/scripts/587483) 点击安装。
3. 打开小红书搜索结果页或用户主页。

### 方式二：本地安装
1. 在桌面版 Chrome 或 Edge 中安装 Tampermonkey。
2. 新建用户脚本，将 [`xhs-enhanced.user.js`](./xhs-enhanced.user.js) 的完整内容粘贴并保存。
3. 打开小红书搜索结果页或用户主页。

脚本仅匹配：

- `https://www.xiaohongshu.com/search_result*`
- `https://www.xiaohongshu.com/user/profile/*`

脚本使用 `@grant none`，不声明网络、存储、剪贴板或菜单权限，不收集或上传页面数据。

## 点赞数规则

- 支持明确的整数、分组整数以及常见的 `万`、`w/W`、`k/K` 缩写；
- 仅当解析结果严格大于用户设置的热门阈值（默认 `100`）时高亮；
- 歧义或无法解析的文本不会高亮；
- 无法确认笔记卡片或点赞控件时会保守跳过，避免误高亮大容器。

## 相关链接

- **GitHub 仓库**：https://github.com/mufeng510/XHS_Enhanced
- **Greasy Fork 脚本**：https://greasyfork.org/zh-CN/scripts/587483

## 本地验证

```bash
npm install
npm test
```

## 许可证

MIT License
