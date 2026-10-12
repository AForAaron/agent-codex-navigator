# Codex Navigator 插件（Explodex）

放置位置（官方用户插件目录，**覆盖同 id 的 bundled 插件**）：

```
~/.explodex/plugins/codex-navigator/plugin.json
~/.explodex/plugins/codex-navigator/index.js
```

从仓库安装（不启动 Codex、不注入）：

```sh
bash scripts/install-plugin.sh
```

默认行为：只 `register`，**不改 Codex DOM**。要看右侧面板，需在 Explodex 设置页打开开关。

另有默认关闭的“实验性：左侧窄栏 Codex 额度”开关。在已验证的 26.1007.21159 应用中，额度栏只读订阅原生菜单的额度缓存，显示五小时与每周剩余百分比、可用重置次数，不独立轮询网络接口。不能确认当前账户查询或接口失效时显示 `—`。使用 `scripts/launch-usage-rail.sh` 启动会自动启用；无按钮、弹层或点击行为，停止脚本会卸载 UI。详见 `docs/CODEX_USAGE_RAIL_20261001.md`。

五小时百分比下方显示距原生自动重置的剩余分钟；每周百分比下方保留本地日期与时刻；“可重置”单独表示手动重置次数。时间缺失显示“未提供”，时间到达而原生尚未更新时显示“待更新”，不推算或伪造额度回满。

同一个本机会话脚本也在普通 Chat 中挂载已渲染提问目录，并按消息内容块保存与恢复阅读位置；在 Codex 界面不挂载第二根目录条。它不是官方 Chat 插件，也尚不保证未渲染历史进入目录。验收及限制见 `docs/CHAT_SESSION_RAIL_20261001.md`。

卸载：删掉该目录，或在 Explodex 设置里 Disable。Safe Mode 见仓库 `docs/SAFE_MODE.md`。
