# Lark 调度联动后端

项目运行、部署、数据同步和排查手册见 [项目维护与交接手册](docs/项目维护与交接手册.md)。

这是一个 Node.js + TypeScript 的中间后端，用于连接：

1. Lark 自建应用，服务端使用 `tenant_access_token`
2. 车辆、门店和调度任务所在的多维表格
3. Tracker 车辆状态同步服务

车辆档案表通过 `VEHICLE_TABLE_IDS` 配置，可以填写公司车辆和门店车辆等多个表 ID。留空时按 `VEHICLE_TABLE_NAMES` 自动寻找表。

已按当前表中的字段名配置：

`任务编号`、`申请人`（界面显示为“驾驶人”）、`出发时间`、`起点`、`目的地`、`车辆`、`当前公里数`、`下次保养公里数`、`保养提醒`、`调度状态`、`自建应用任务ID`、`执行结果`、`错误信息`。

新增联动字段（需要在调度任务表中创建）：

`行程阶段`（单选）、`出发车辆照片`（附件）、`出发拍照时间`（日期时间）、`出发检查结果`（单选）、`出发照片备注`（多行文本）、`返程公里数`（数字）、`返程车辆照片`（附件）、`返程拍照时间`（日期时间）、`返程检查结果`（单选）、`返程照片备注`（多行文本）、`车辆损伤说明`（多行文本）。检查结果建议预置 `外观正常`、`发现损伤`、`其他` 三个选项。

车辆档案表已按实际字段适配：`Number Plate | 车牌号码`、`Vehicle Brand | 车辆品牌`、`Model | 车型`、`Vehicle Type | 车辆类型`、`Vehicle Status | 车辆状态`、`Store | 所属门店`、`Department | 所属部门`、`Year | 年份`、`Vehicle Photo | 车辆照片`、`Maintenance mileage`、`Next Service Due | 下次保养里程`、`Insurance`、`Policy Number | 保单号`、`Certificate Expiry | 证书有效期`、`Fuel card picture | 加油油卡图片`（也支持 `Fuel card picture | 加油卡图片`）和 `Fuel Card | 加油油卡号`（也支持 `Fuel Card | 加油卡号`）。车辆大本字段为 `log book | 车辆登记证书`。后端会自动识别这些字段，也可以用 `.env` 中对应的 `VEHICLE_*_FIELDS` 覆盖。

调度车牌下拉会自动过滤包含 `sold`、`已售`、`under maintenance`、`out of service`、`报废`、`维修中` 或 `停用` 的车辆，避免将不可用车辆派出。

## 当前行为

- 每 60 秒轮询一次调度表。
- 门店资料表提供起点、目的地固定选项，名称字段可通过 `STORE_NAME_FIELDS` 配置。
- 手机申请页提交“当前公里数”，后端按数字类型写入多维表格；调度台显示当前公里数和“保养提醒”。
- 输入车牌后，后端会匹配车辆档案表中的 `Number Plate | 车牌号码`，自动带出 `Next Service Due | 下次保养里程`；提交后仅在新公里数不小于档案值时回写 `Maintenance mileage`，避免里程倒退。
- 驾驶人下拉选项来自 Lark 公司通讯录，写入多维表格的 `申请人` 人员字段；人员会按所属部门分组显示，车辆下拉选项来自公司车辆/门店车辆档案，并显示车型描述。
- 起点和目的地支持直接手动输入，也可使用门店固定清单快速选择；任务编号沿用调度表自动编号，不由前端重复写入。
- 出发和返程均支持前、后、左、右四张必拍照片及一张选填的补充照片；浏览器端压缩，并添加时间、阶段和方位水印，不读取或保存设备位置。返程登记会回写返程公里数、检查结果、照片备注和意外损伤说明，并用返程公里数更新车辆档案公里数。
- 桌面端默认是车辆总览一级界面，支持按所属部门 / 门店分类，显示车辆照片、车型、车牌、当前公里数和保养状态；车辆卡片进入二级“车辆档案”详情，再进入三级“编辑车辆资料”表单，编辑完成后返回档案详情。移动设备调度一级页为 `/?view=apply`，只提供“出发”和“返回”两项操作。
- 车辆编辑页已覆盖公司车辆表中的车牌、品牌、车型、类型、状态、所属部门、年份、注册地点、保养资料、证件 / 保险资料、公里数和车辆照片；不存在的字段不会被后端虚构写入。
- 后端轮询调度表时也会补齐车辆的下次保养里程，并将任务公里数同步到车辆档案。
- 普通调度记录默认状态为 `待调度`；移动端完成出发登记后写入 `执行中`。车辆预约先写入 `已预约`，必须由具备排程权限的后台用户同意后才更新为 `已排程`。
- 只有状态为 `已排程` 且出发时间已到的记录才会分配唯一的 `dispatch_...` 任务 ID；预约不会因为到点被自动同意。
- 后端把任务 ID和入队结果回写到多维表格；配置执行器后再由执行器更新为 `执行中`、`已完成` 或 `失败`。
- 未配置 `DISPATCH_EXECUTOR_URL` 时，不会伪造“执行成功”；任务会停留在 `已排程`。
- 配置执行器后，后端会 POST 任务到执行器；执行器可调用回调接口更新为 `执行中`、`已完成` 或 `失败`。

## 启动

```bash
npm install
Copy-Item .env.example .env
# 编辑 .env，至少填写 LARK_APP_SECRET、INTERNAL_API_TOKEN 和首次管理员账号
npm run dev
```

只预览前端时，可以不配置 Lark Secret：

```bash
$env:PREVIEW_MODE="true"
npm run dev
```

预览模式使用本地样例数据，访问 `http://localhost:3000/` 后会自动连接，所有操作不会写入真实多维表格。

生产环境：

```bash
npm run build
npm start
```

Windows 服务器可以使用 Node.js + PM2 运行，并通过受控的 HTTPS 入口访问：

```text
https://your-domain.example/
```

应用由 `dist/server.js` 运行。生产 OAuth 回调应配置为：

```text
https://your-domain.example/api/auth/lark/callback
```

也可以使用 Docker：

```bash
docker build -t lark-dispatch-backend .
docker run --env-file .env -p 3000:3000 -v dispatch-data:/app/data lark-dispatch-backend
```

App Secret 只能放在部署平台的环境变量或密钥管理服务中，不要提交到 Git。

## 登录、账号与权限

应用已改为基于服务端 Session 的账号登录，不再把 `INTERNAL_API_TOKEN` 暴露在浏览器界面。

- 正常登录后默认进入移动调度 `/?view=apply`；登录页另有“登录后进入桌面调度”入口。账号没有桌面权限时会自动回到移动调度。
- `dispatcher`（调度员）：移动端出发和返程登记。
- `scheduler`（排程员）：移动调度、桌面调度台和立即同步。
- `fleet_manager`（车队管理员）：移动调度、桌面调度台和车辆资料编辑。
- `admin`（管理员）：全部权限，并可访问 `/accounts` 管理账号、角色和启停状态。

首次上线请在 `.env` 设置 `AUTH_BOOTSTRAP_ADMIN_USERNAME` 与 `AUTH_BOOTSTRAP_ADMIN_PASSWORD`。这会创建唯一的初始管理员独立账号；管理员可在“账号管理”页面创建其他独立账号，或在 Lark 用户首次登录后为其调整角色。至少需要保留一个启用中的管理员。

### 使用 Lark 账号登录（推荐）

Lark OAuth 已提供完整授权码登录链路。生产环境中设置：

```text
LARK_OAUTH_REDIRECT_URI=https://你的域名/api/auth/lark/callback
LARK_OAUTH_SCOPES=
LARK_DEFAULT_ROLE=dispatcher
```

同时在对应 Lark 自建应用的“安全设置 > 重定向 URL”添加一模一样的回调地址。登录时系统会将用户跳转至 Lark 的 OAuth 页面，回调后用 `user_access_token` 调用 `authen/v1/user_info` 验证身份；用户的 access token 不落盘，只保存本应用的随机 Session。若暂时未配置公网回调地址，登录页会只显示独立账号入口。

预览模式会保留预览管理员接口，但登录页只在折叠的“预览测试入口”中显示，不占用正式登录主界面；生产环境不会生成默认密码。

## API

业务接口支持登录后的 HttpOnly `dispatch_session_v2` 会话 Cookie。正常结束浏览器会话后需重新登录；在同一次浏览器会话中切换页面仍保持登录。若浏览器开启“恢复上次会话”，可能连会话 Cookie 一起恢复；需要在设备上关闭该选项才能严格按关闭程序清除登录。服务器端 Session 默认最多有效 12 小时（`AUTH_SESSION_TTL_SECONDS` 可覆盖）。调度执行器等服务端调用仍可使用以下内部请求头。未登录或权限不足时分别返回 `401` / `403`。

服务端调用可使用以下任一请求头：

```text
Authorization: Bearer <INTERNAL_API_TOKEN>
```

或：

```text
X-Internal-Api-Token: <INTERNAL_API_TOKEN>
```

立即同步：

```http
POST /api/sync
```

选项接口：

```http
GET /api/options
```

返回 `users`、`vehicles` 和 `stores`；人员来自 Lark 通讯录，车辆来自配置的车辆档案表，门店来自门店资料表。

出发照片和返程登记：

```json
POST /api/tasks/<record_id>/photos
{
  "phase": "departure",
  "checkResult": "外观正常",
  "photoNotes": "补充说明（可选）",
  "photos": [{"position":"front","dataUrl":"data:image/jpeg;base64,...","capturedAt":"2026-09-08T08:00:00Z"}]
}

POST /api/tasks/<record_id>/return
{
  "returnMileage": 125380,
  "damageDescription": "无",
  "checkResult": "外观正常",
  "photoNotes": "补充说明（可选）",
  "photos": []
}
```

由自建应用创建记录：

```json
POST /api/tasks
{
  "clientToken": "fe599b60-450f-46ff-b2ef-9f6675625b97",
  "fields": {
    "申请人": [{"id": "ou_xxx"}],
    "出发时间": "2026-09-07T15:00:00+02:00",
    "起点": "A",
    "目的地": "B",
    "车辆": "MN48XPGP",
    "调度状态": "待调度"
  }
}
```

`clientToken` 使用标准 UUID v4；调用方重试同一个创建请求时复用同一个 `clientToken`，Lark 才能按幂等请求处理，避免产生重复记录。

执行器回调：

```json
POST /api/executor/callback
{
  "jobId": "dispatch_xxx",
  "status": "completed",
  "result": "车辆已派出"
}
```

`status` 可取 `accepted`、`running`、`completed`、`failed`。

## 上线前检查

1. 在 Lark 开发者后台为自建应用开通多维表格读写权限。
2. 将该多维表格共享/授权给应用可访问的身份。
3. 配置 `LARK_APP_SECRET`、`INTERNAL_API_TOKEN`、`STORE_BITABLE_APP_TOKEN` 和 `STORE_TABLE_ID`，并在 `VEHICLE_TABLE_IDS` 填写车辆档案表 ID；若不填 ID，应用还需要能读取 Base 的表清单。
4. 确认自建应用具备多维表格记录读写权限、素材上传权限、读取车辆表/字段的权限，以及通讯录只读权限（例如 `contact:contact:readonly` 或 `contact:contact:readonly_as_app`）。部门通知设置按群名称搜索还需要在 Lark 开放平台为机器人开通 `im:chat:read`（或接口提示支持的等效权限）并发布应用版本；未开通时仍可手动输入 `oc_` 群 ID。
5. 若需要真正执行调度，再配置 `DISPATCH_EXECUTOR_URL`；否则系统只负责入队和台账回写。
6. 在调度表创建或确认以下字段：`当前公里数`（数字）、`下次保养公里数`（数字）、`返程公里数`（数字）、`出发车辆照片`（附件）、`返程车辆照片`（附件）、`出发拍照时间`（日期时间）、`返程拍照时间`（日期时间）、`出发检查结果`（单选）、`出发照片备注`（文本）、`返程检查结果`（单选）、`返程照片备注`（文本）、`车辆损伤说明`（文本）、`行程阶段`（单选）、`保养提醒`（建议使用公式字段）。公式可按团队保养规则判断 `当前公里数 >= 下次保养公里数`，例如：

```text
IF(OR([当前公里数]=0,[下次保养公里数]=0),\"未设置\",IF([当前公里数]>=[下次保养公里数],\"需要保养\",\"正常\"))
```

7. 先用测试记录验证“车牌匹配 → 自动带出下次保养里程 → 回写车辆档案公里数 → 保养提醒变化”，再启用生产轮询。

任务映射当前保存在 `STORE_PATH` 指定的 JSON 文件中，适合单实例部署。若未来部署多个副本，应将 `JobStore` 换成共享数据库或 Redis，避免多个实例重复调度。

## Tracker 车辆位置状态同步

Tracker 自带计划报表只支持日、周和月级频率。需要更及时的车辆位置状态时，使用独立 worker：

```powershell
npm run build
$env:TRACKER_SYNC_ENABLED="true"
node dist/tracker-sync.js --once
```

### Tracker 每日报表邮箱同步

如果 Tracker 将 `Trip Report (Detail)` 按天以 CSV 附件发送到专用 Gmail，后台可以通过 Gmail OAuth2 + IMAP 读取最新附件。生产环境配置 `TRACKER_REPORT_EMAIL_ENABLED=true`、邮箱账号、OAuth 客户端 ID、客户端密钥和刷新令牌后，worker 默认每天服务器时间 02:00 检查一次；没有新文件时每 30 分钟重试，最晚到 06:00。成功后保存 CSV 和解析结果，按邮件 ID 与文件哈希去重。邮箱读取使用只读 IMAP，不删除或标记邮件。OAuth 授权范围必须包含 `https://mail.google.com/`，不使用 Gmail 普通登录密码。

首次授权流程：

1. 在 Google Cloud Console 创建项目，配置 OAuth consent screen，将 `Valuecoreport@gmail.com` 加入测试用户，并创建 OAuth Client ID（Desktop app）；同时启用 Gmail API。
2. 在本地 PowerShell 设置客户端信息并运行授权脚本。脚本会打开 Google 授权页，授权账号必须是 `Valuecoreport@gmail.com`：

```powershell
$env:GMAIL_OAUTH_CLIENT_ID="你的客户端ID"
$env:GMAIL_OAUTH_CLIENT_SECRET="你的客户端密钥"
$env:TRACKER_REPORT_EMAIL_USER="Valuecoreport@gmail.com"
npm run gmail:oauth
```

3. 将脚本输出的 `GMAIL_OAUTH_REFRESH_TOKEN` 配置到服务器的 `TRACKER_REPORT_EMAIL_REFRESH_TOKEN`。客户端密钥和刷新令牌只放服务器环境变量，不提交 Git。

解析使用 `Reg`、`ReportStart`、`ReportEnd`、`VehOdometerStart` 和 `VehOdometerEnd`；同一车辆的结束公里数出现冲突时保留报表但标记为不一致，不进入自动补写。OAuth 客户端密钥和刷新令牌只保存在服务器环境变量，不提交到 Git。

启用 `TRACKER_MILEAGE_SYNC_ENABLED=true` 后，报表解析结果会按“车辆档案 Tracker 编号 → VIN → 车牌”匹配车辆，只写入高于当前档案值的 `VehOdometerEnd`；报表值较低、同一车辆报表值冲突、字段缺失或无法唯一匹配时只保存审计结果，不写回。同步审计保存在 `data/tracker-mileage-sync.json`，并按报表文件哈希去重；同一报表如有 `error` 记录，仅重试失败车辆并保留此前成功记录的审计。当天已下载报表尚未完成或存在写回错误时，会在 02:00–06:00 窗口按 30 分钟冷却重试。今天已下载的报表可用 `node dist/tracker-sync.js --email-mileage-dry-run` 预览，确认后用 `node dist/tracker-sync.js --email-mileage-once` 执行。

自动报表更新与出发/返程行程写回相互独立；行程提交继续写正常的出发公里数和返程公里数，报表同步在写入前重新读取车辆档案并再次比较，不能覆盖更高的行程公里数。车辆总览和车辆档案详情会以小字和颜色标出当前值来自 Tracker 报表；如果之后被行程公里数更新为更高值，该标记自动消失。

生产默认读取 Tracker 实时车辆列表，每 5 分钟更新一次 `data/tracker-status.json`，不开放额外端口。PDF 报表下载默认关闭；只有确认目标账户的下载流程稳定并确实需要刷新 VIN、设备号或里程时，才设置 `TRACKER_REPORT_DOWNLOAD_ENABLED=true`。

- 车辆总览以 Tracker 返回的车辆实际状态替代车辆档案中的使用状态，并同时显示 Tracker 更新状态；车辆档案使用状态仍保留在档案详情和编辑界面。点击“车辆位置状态”后，在独立二级菜单中显示最后位置、车辆实际状态、Tracker 里程、数据时间和同步状态。
- 数据时效分为 10 分钟内“最新”、10 至 30 分钟“延迟”、30 分钟至 2 小时“过期”、2 至 24 小时“可能离线”、超过 24 小时“需要检查设备”。同步失败时继续显示上一次成功快照并至少标记为过期。
- Tracker 状态接口要求已登录且具备 `mobile_dispatch` 权限。管理员可查看全部车辆；其他账号由服务端按账号部门过滤车辆与 Tracker 匹配结果，接口不会下发其他部门的原始 Tracker 列表。
- 匹配优先使用唯一 VIN，再回退到唯一车牌。重复 VIN、重复车牌或非空 VIN 冲突会进入“待确认”，不会覆盖车辆档案。
- 管理车辆权限可提交“立即刷新”请求；请求由现有 worker 消费并继续遵守最短 5 分钟同步间隔，不会启动第二个浏览器实例。
- 最新状态保存在 `data/tracker-status.json`；位置变化历史按日保存在 `data/tracker-history`，默认精确保留 90 天并由服务端按账号部门过滤。PDF 解析完成后删除临时文件；Tracker 凭据只保存在生产环境变量中。
