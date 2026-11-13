# 归档：油猴（Tampermonkey）时代文件

这些是扩展迁移之前的用户脚本产物，仅保留作参考，**不参与构建、测试或发布**，也不再维护。确认没有价值后可以整体删除本目录。

| 文件 | 说明 |
|---|---|
| `xhs-enhanced.user.js` | 油猴脚本 v1.9.0（迁移前最后版本，来源 commit `e8ba7fc`，2454 行） |
| `userscript.test.cjs` | 油猴脚本的单元测试（node:test + vm，针对 `.user.js`） |
| `greasyfork-additional-info.html` | Greasy Fork 脚本页的附加说明 HTML |

- 归档日期：2026-11-13（迁移为 Chrome/Edge MV3 扩展时一并归档）
- 来源提交：`e8ba7fc`（迁移前 master 的最后一个版本）
- 需要时可从 Git 历史随时恢复（`git log -- archive/` 不适用：这些文件已从工作区删除，历史仍存在于 `e8ba7fc`）。
