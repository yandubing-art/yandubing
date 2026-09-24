# 车辆调度平台交接总结

更新时间：2026-09-23

## 项目

- GitHub：`https://github.com/yandubing-art/yandubing`
- 分支：`main`
- 线上地址：`https://serversmall.tail422add.ts.net:10000/`
- 服务器目录：`C:\Applications\lark-dispatch-backend`
- 进程：`lark-dispatch`、`lark-tracker-sync`

## 本版本已完成

- 移动端出发、中转、返回任务流程和任务返回入口。
- 中文/英文按设备语言自动选择，并支持当前会话语言覆盖。
- 角色权限与个人账号权限分离配置，包含权限管理二级页面。
- 车辆按权限、部门和任务归属过滤；调度场景支持查看授权范围内的车辆。
- 车辆字段选项手动维护，并同步到飞书多维表格。
- Tracker 状态显示更新时间跨度和车辆实际状态；重复车辆按最新位置合并显示。
- 车辆资料支持选择已同步的 Tracker 车辆作为匹配项；设置后优先按指定 Tracker 匹配，未设置时继续按 VIN/车牌匹配。
- Tracker 匹配值保存在车辆档案的 Tracker 文本字段；使用前需在飞书多维表格车辆档案中配置该字段。
- Tracker 历史查询快速范围：1 小时、2 小时、4 小时、6 小时、12 小时、24 小时、7 天、30 天、90 天。
- 车辆照片以后台原图为主同步到飞书 Base；飞书 Base 管理员 OAuth 仍需在后台完成授权。
- 保养和年检提醒配置，支持提前天数、发送频率和发送次数设置。
- 移动端加载遮罩、缓存、过渡动画和触摸设备滚动性能优化。
- 默认入口按设备分流：Windows/macOS 默认先进入后台登录页，登录后进入桌面总览；手机和平板默认先进入移动登录页，登录后进入移动调度。
- 根路径 `/` 和 `/index.html` 不带 `view` 时始终先进入登录页并清理旧会话；桌面端旧的 `?view=apply` 入口也会先进入后台登录页，登录后进入桌面总览。退出登录按原登录入口返回。
- 车辆资料编辑页优先按车牌/VIN自动关联 Tracker 实时记录；匹配到时展示 Tracker 编号、状态、位置和数据/同步时间，并可将编号保存到车辆档案 Tracker 字段。同步间隔由 `TRACKER_SYNC_INTERVAL_SECONDS` 控制，前端状态轮询为 60 秒。
- Tracker 字段识别同时读取车辆表字段定义，空值记录也能识别为已配置，避免因飞书省略空字段而误报未配置。
- Tracker `Trip Report (Detail)` 每日报表支持通过 Gmail OAuth2 + IMAP 自动读取 CSV 附件：默认服务器时间每天 02:00 首次检查，未发现新文件时每 30 分钟重试至 06:00；按邮件 ID 和文件哈希去重，解析结果保存到 `data/tracker-email-report.json`，原始 CSV 保存到 `data/tracker-email-reports`，邮箱读取为只读且不删除邮件。服务器只保存 OAuth 客户端密钥和刷新令牌，不保存 Gmail 登录密码；Google OAuth 授权范围必须包含 `https://mail.google.com/`。
- Tracker 每日报表公里数自动更新已接入：报表成功读取后按车辆档案 Tracker 编号、VIN、车牌依次唯一匹配，仅当 `VehOdometerEnd` 高于当前档案公里数时写回；较低公里数、报表冲突、缺少字段和无法唯一匹配的记录不会写回。同步前会重新读取车辆档案并再次比较，避免覆盖并发提交的出发/返程公里数；出发/返程任务字段与报表同步互不改写。审计保存在 `data/tracker-mileage-sync.json`，按 CSV 哈希去重。
- 车辆总览卡片和车辆档案详情会标注“Tracker报表更新”的公里数来源；行程列表中的出发/返程公里数保持正常颜色。若之后行程写入更高公里数，来源标记会自动消失。
- 车辆管理页面进入车辆详情或编辑页时自动回到顶部；保养提交区域使用紧凑尺寸。
- 全页面表单布局基准：两列表单固定为 `1fr / 1fr`，左右列使用相同内边距和间距；输入框、选择框、文件框和文本框占满所在列并限制最小宽度；单控件字段统一为 48px 高度；带辅助文字和不带辅助文字的字段预留相同提示行，保证左右输入框在同一水平线上；含多个联动控件的字段（驾驶人、车辆、地点快速选择）保持自身联动布局；屏幕宽度 650px 以下改为单列，651px 至 800px 使用统一 12px 列间距。后续新增表单应复用 `.form-grid` / `.form-row`，不要单独设置不对称左右尺寸。

## 验证结果

本地已通过：

- `node --check web/app.js`
- 主要前端脚本语法检查
- `node_modules/.bin/tsc.cmd -p tsconfig.json --noEmit`
- `npm run build`
- `git diff --check`

最近版本已部署到线上；部署前会在服务器 `deploy-backups` 下保留对应 `web` 或 `dist` 备份。

部署后线上健康检查返回 HTTP `200`。Tracker 快速范围前端资源已更新版本号，手机端刷新后会加载新资源。

2026-09-23 Tracker Gmail CSV 公里数同步复核：

- 修复同一 CSV 部分车辆写回失败后被整体跳过的问题；后续尝试只重试 `error` 记录，保留此前成功记录的审计。当天已下载报表若尚未完成或存在写回错误，会在 02:00–06:00 窗口按 30 分钟冷却重试。
- 生产 `dist/tracker-mileage-sync.js` 和 `dist/tracker-sync.js` 已更新并校验哈希；`lark-dispatch` 与 `lark-tracker-sync` 均已重启，`/health` 返回 200。部署备份位于 `deploy-backups/tracker-mileage-retry-20260923-131403`。
- 使用唯一虚拟车号向配置的 Gmail 收件箱发送带 CSV 附件的测试邮件；隔离状态成功收取并解析 1 条记录，只读匹配结果为 `not_found`，未写入车辆档案。测试邮件已移出收件箱，正式报表审计未被覆盖。
- 部署时正式报表审计包含 27 辆车：14 辆 `updated`、6 辆 `missing_mileage_field`、7 辆 `not_found`；14 辆成功记录均已从飞书车辆档案回读一致。下一次真正的定时窗口为 2026-09-24 02:00–06:00（服务器当地时间），仍需在窗口结束后核对自动触发日志。

2026-09-24 门店车辆公里数修复上线：

- `Stores Vehicle|门店车辆` 缺少当前公里数字段，已新增 `Maintenance mileage`；`Company Vehicle|公司车辆` 已新增 `Tracker Registration`，并为 VIN `WV1ZZZSY5S9025548` 的档案补录 Tracker 编号 `MM72ZGGP`，车牌 `MM47ZGGP` 保持不变。
- 同一 CSV 的 `missing_mileage_field` 与 `not_found` 现在会在字段或车辆匹配信息修正后重新处理；其他非错误审计状态仍按原逻辑保留。
- 已部署 `dist/tracker-mileage-sync.js`，备份位于 `deploy-backups/tracker-mileage-retry-20260924`；重新处理 2026-09-22 报表后审计为 20 辆 `updated`、1 辆 `unchanged`、6 辆 `not_found`，没有 `error`。其中 6 辆门店车辆里程已从 Lark 回读确认：JJ16HDGP 247488、LZ26XFGP 16514、MJ50MKGP 41941、227CRCGP 18839、MJ50LKGP 15876、LN98TXGP 34428 km；Crafter 档案按 Tracker 编号匹配并写入 37422 km。
- 其余 3 条门店档案（DD45YKZN、RJ 478、MZ95NCGP）未出现在这份 CSV，仍为空，待后续报表提供数据。`lark-dispatch` 与 `lark-tracker-sync` 已在线并保存 PM2 进程清单，生产 `/health` 返回 HTTP 200。

## 运行注意事项

- 生产环境密钥、Lark OAuth 配置、Tracker 凭据和本地运行数据不提交到 GitHub；继续通过服务器环境变量维护。
- 照片写回多维表格需要已连接拥有车辆档案 Base 权限的管理员账号。
- 修改角色权限后，新权限会影响后续登录与接口鉴权；已有会话遇到权限变化时建议重新登录。
- Tracker 数据依赖后台同步进程持续运行；发现状态停留时先检查 `lark-tracker-sync` 日志和 Tracker 凭据。
- 每日报表邮箱同步依赖 Gmail OAuth2 客户端配置和刷新令牌；先检查 `lark-tracker-sync` 日志中的 `Tracker email report check`，再检查服务器 `data/tracker-email-report.json` 的 `lastError`、`reportEnd` 和 `records`。OAuth 授权失败时不要改回普通 Gmail 密码，重新检查 Google Cloud OAuth 同意屏幕、`https://mail.google.com/` scope 和刷新令牌。
- 每日报表公里数同步还需检查 `lark-tracker-sync` 日志中的 `Tracker email mileage sync`，以及 `data/tracker-mileage-sync.json` 的 `sourceHash`、`completedAt` 和逐车 `status`。一次性预览使用 `node dist/tracker-sync.js --email-mileage-dry-run`，实际处理已下载报表使用 `node dist/tracker-sync.js --email-mileage-once`。
- 前端发布后如仍显示旧按钮，使用浏览器强制刷新或退出后重新进入。

## 后续建议

- 在真实账号下分别验证管理员、调度员、车队管理员和普通个人账号的页面与接口权限。
- 用一台低配 Android 设备完成出发、上传照片、中转和返回的完整链路测试。
- 检查飞书 Base 中车辆车牌、照片、保养和年检字段的实际写回结果，并保留一组测试记录。
