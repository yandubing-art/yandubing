(() => {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") || "apply";
  const isMobile = ["apply", "departure", "transfer", "return", "booking"].includes(view);
  const entryMode = sessionStorage.getItem("dispatch_entry_mode_v1");
  const userAgent = navigator.userAgent || "";
  const mobileDevice = navigator.userAgentData?.mobile === true || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  const desktopDevice = /Windows NT|Macintosh|X11|Linux x86_64/i.test(userAgent);
  const desktopEnvironment = !mobileDevice && (desktopDevice || window.matchMedia?.("(min-width: 701px)").matches);
  if (desktopEnvironment && view === "apply" && !entryMode) {
    window.location.replace("/admin-login?next=%2F%3Fview%3Doverview");
    return;
  }
  const isTransferView = view === "transfer";
  const isReturnOnly = view === "return";
  const phoneLanguages = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  const browserLanguage = phoneLanguages.some((language) => /^zh(?:-|$)/i.test(String(language))) ? "zh" : "en";
  const languageOverride = sessionStorage.getItem("dispatch_language_override_v2");
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchDevice = coarsePointer || Number(navigator.maxTouchPoints || 0) > 0;
  const lowPerformanceDevice = /Android/i.test(navigator.userAgent || "")
    || (Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4)
    || (Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory <= 4);
  // iPadOS Safari can report itself as Macintosh. Use touch capability rather
  // than the platform string so Windows touch laptops and Mac touch devices
  // get the same low-paint scroll path.
  const scrollPerformanceDevice = isMobile || touchDevice || lowPerformanceDevice;
  if (lowPerformanceDevice) document.documentElement.classList.add("low-performance");
  if (scrollPerformanceDevice) document.documentElement.classList.add("scroll-performance");
  const timelineScales = ["day", "hour", "week", "month", "year"];
  const photoPositions = ["front", "rear", "left", "right"];
  const allPhotoPositions = [...photoPositions, "extra"];
  const state = {
    language: languageOverride === "en" || languageOverride === "zh" ? languageOverride : browserLanguage,
    mobileFlow: view,
    user: null,
    tasks: [],
    users: [],
    vehicles: [],
    stores: [],
    editingRecordId: "",
    editingVehicle: null,
    creatingVehicle: false,
    vehiclePhotoDataUrl: "",
    vehiclePhotoFullDataUrl: "",
    vehiclePhotoThumbnailDataUrl: "",
    vehicleEditorBaseline: "",
    logBookDocument: null,
    fleetCardPhotoDataUrl: "",
    maintenanceRecords: [],
    maintenanceVehicleKey: "",
    photoSync: null,
    photos: { departure: {}, return: {} },
    photoCapturedAt: { departure: {}, return: {} },
    notificationSettings: [],
    notificationReminders: {
      maintenance: { enabled: true, daysBefore: 30, mileageBefore: 1000, frequencyHours: 24, maxSends: 3 },
      inspection: { enabled: true, daysBefore: 30, mileageBefore: 0, frequencyHours: 24, maxSends: 3 }
    },
    trackerStatus: null,
    trackerVehicleKey: "",
    trackerHistoryEntries: [],
    trackerHistoryRouteLocations: [],
    trackerHistoryRoutePointCount: 0,
    trackerHistoryHasMore: false,
    trackerHistoryNextOffset: 0,
    trackerHistoryRetentionDays: 90,
    trackerHistoryLoaded: false,
    vehicleFieldOptions: { brand: [], model: [], type: [], status: [], owner: [], registeringAuthority: [], insurance: [] },
    vehicleFieldDefinitions: { tables: [] },
    timelineScale: timelineScales.includes(params.get("timelineScale")) ? params.get("timelineScale") : "day",
    selectedTaskId: "",
    lastInspectedTaskId: "",
    quickStatusFilter: "",
    hasUnsavedChanges: false,
    optionsLoading: false,
    optionsError: ""
  };
  const OPTIONS_CACHE_KEY_PREFIX = "dispatch_options_cache_v3:";
  const OPTIONS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  function optionsCacheKey() {
    const account = state.user?.accountId || state.user?.username || "anonymous";
    return `${OPTIONS_CACHE_KEY_PREFIX}${encodeURIComponent(account)}`;
  }

  function loadOptionsCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(optionsCacheKey()) || "null");
      if (!cached || typeof cached !== "object" || (cached.savedAt && Date.now() - cached.savedAt > OPTIONS_CACHE_MAX_AGE_MS)) return false;
      state.users = Array.isArray(cached.users) ? cached.users : [];
      state.vehicles = Array.isArray(cached.vehicles) ? cached.vehicles : [];
      state.stores = Array.isArray(cached.stores) ? cached.stores : [];
      state.vehicleFieldOptions = cached.vehicleFieldOptions && typeof cached.vehicleFieldOptions === "object" ? cached.vehicleFieldOptions : state.vehicleFieldOptions;
      if (isMobile) {
        renderDispatchVehicleOptions();
        window.setTimeout(() => renderOptions(), 0);
        return true;
      }
      renderOptions();
      renderVehicleDepartmentFilter();
      renderVehicles();
      renderRows();
      renderHistory();
      renderTrackerHistoryVehicleOptions();
      renderVehicleEditorOptions();
      return true;
    } catch (_) {
      // A blocked or malformed browser cache must never prevent Lark loading.
      return false;
    }
  }

  function saveOptionsCache() {
    try {
      localStorage.setItem(optionsCacheKey(), JSON.stringify({ users: state.users, vehicles: state.vehicles, stores: state.stores, vehicleFieldOptions: state.vehicleFieldOptions, savedAt: Date.now() }));
    } catch (_) {
      // Quota/private-mode errors are non-fatal; the server cache still works.
    }
  }
  const $ = (id) => document.getElementById(id);
  const form = $("taskForm");
  const transferForm = $("transferForm");
  const bookingForm = $("bookingForm");
  const vehicleForm = $("vehicleForm");
  const maintenanceForm = $("maintenanceForm");
  const notice = $("notice");
  const appLoadingOverlay = $("appLoadingOverlay");
  const appLoadingTitle = $("appLoadingTitle");
  const appLoadingDetail = $("appLoadingDetail");
  let appReady = false;
  const rows = $("taskRows");
  const bookingRows = $("bookingRows");
  const searchInput = $("searchInput");
  const statusFilter = $("statusFilter");
  const vehicleDepartmentFilter = $("vehicleDepartmentFilter");
  const vehicleDepartmentQuickSelect = $("vehicleDepartmentQuickSelect");
  const bookingVehicleDepartmentQuickSelect = $("bookingVehicleDepartmentQuickSelect");
  const requesterInput = $("requesterInput");
  const bookingRequesterInput = $("bookingRequesterInput");
  const requesterMatchStatus = $("requesterMatchStatus");
  const bookingRequesterMatchStatus = $("bookingRequesterMatchStatus");
  const returnOriginInput = $("returnOriginInput");
  const returnDestinationInput = $("returnDestinationInput");
  const returnOriginQuickSelect = $("returnOriginQuickSelect");
  const returnDestinationQuickSelect = $("returnDestinationQuickSelect");
  const transferLocationInput = $("transferLocationInput");
  const transferLocationQuickSelect = $("transferLocationQuickSelect");
  const transferNotice = $("transferNotice");
  const vehicleStatus = $("vehicleStatus");
  const historyRows = $("historyRows");
  const historySearchInput = $("historySearchInput");
  const historyVehicleFilter = $("historyVehicleFilter");
  const historyRequesterFilter = $("historyRequesterFilter");
  const historyStatusFilter = $("historyStatusFilter");
  const historyDateFrom = $("historyDateFrom");
  const historyDateTo = $("historyDateTo");
  const taskTimeline = $("taskTimeline");
  const notificationSettingsContent = $("notificationSettingsContent");
  const photoSyncStatus = $("photoSyncStatus");
  const trackerVehicleDialog = $("trackerVehicleDialog");
  const trackerDialogBody = $("trackerDialogBody");
  const trackerDialogTitle = $("trackerDialogTitle");
  const trackerDialogSubtitle = $("trackerDialogSubtitle");
  const trackerDialogNotice = $("trackerDialogNotice");
  const trackerRefreshButton = $("trackerRefreshButton");
  const trackerHistoryVehicleButton = $("trackerHistoryVehicleButton");
  const trackerHistoryForm = $("trackerHistoryForm");
  const trackerHistoryVehicle = $("trackerHistoryVehicle");
  const trackerHistoryFrom = $("trackerHistoryFrom");
  const trackerHistoryTo = $("trackerHistoryTo");
  const trackerHistoryQuery = $("trackerHistoryQuery");
  const trackerHistoryStatus = $("trackerHistoryStatus");
  const trackerHistoryOrder = $("trackerHistoryOrder");
  const trackerHistoryLimit = $("trackerHistoryLimit");
  const trackerHistoryRows = $("trackerHistoryRows");
  const trackerHistorySummary = $("trackerHistorySummary");
  const trackerHistoryRouteButton = $("trackerHistoryRouteButton");
  const trackerHistoryRouteSummary = $("trackerHistoryRouteSummary");
  const trackerHistoryLoadMore = $("trackerHistoryLoadMore");

  function updateQueryState(values) {
    const url = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function updateTimelineScaleControls() {
    document.querySelectorAll("button[data-timeline-scale]").forEach((button) => {
      const selected = button.dataset.timelineScale === state.timelineScale;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function restoreFilterState() {
    if (searchInput) searchInput.value = params.get("taskSearch") || "";
    if (statusFilter) statusFilter.value = params.get("taskStatus") || "";
    if ($("timelineDateFrom")) $("timelineDateFrom").value = params.get("timelineDateFrom") || "";
    if ($("timelineDateTo")) $("timelineDateTo").value = params.get("timelineDateTo") || "";
    if (historySearchInput) historySearchInput.value = params.get("historySearch") || "";
    if (historyVehicleFilter) historyVehicleFilter.value = params.get("historyVehicle") || "";
    if (historyRequesterFilter) historyRequesterFilter.value = params.get("historyRequester") || "";
    if (historyStatusFilter) historyStatusFilter.value = params.get("historyStatus") || "";
    if (historyDateFrom) historyDateFrom.value = params.get("historyDateFrom") || "";
    if (historyDateTo) historyDateTo.value = params.get("historyDateTo") || "";
    updateTimelineScaleControls();
  }

  // Keep Base values (such as vehicle types, store names and task status values)
  // unchanged. This catalogue only translates the application interface.
  const zhToEn = {
    "车辆调度控制台": "Vehicle Dispatch Console", "移动设备调度": "Mobile Vehicle Dispatch", "移动设备调度 · 出发": "Mobile Vehicle Dispatch · Departure", "移动设备调度 · 中转": "Mobile Vehicle Dispatch · Transfer", "移动设备调度 · 返回": "Mobile Vehicle Dispatch · Return", "先看车况，再进入调度或车辆档案": "Review vehicle status, then dispatch or manage fleet records", "仅用于车辆出发、中转与返回登记": "For departure, transfer and return records only", "手机调度": "Mobile dispatch", "桌面调度台": "Desktop console", "车辆预约": "Vehicle reservation", "出行记录": "Trip records", "返回选择操作": "Back to action menu", "立即同步": "Sync now", "退出登录": "Sign out", "账号管理": "Account management", "通知设置": "Notification settings", "当前用户": "Signed-in user", "管理员": "Administrator", "调度员": "Dispatcher", "排程员": "Scheduler", "车队管理员": "Fleet manager", "正在加载车辆调度": "Loading vehicle dispatch", "正在确认登录状态…": "Checking sign-in status…", "正在读取账户权限…": "Reading account permissions…", "正在读取车辆和任务数据…": "Loading vehicles and tasks…", "正在打开目标页面…": "Opening the requested page…", "加载失败": "Loading failed", "请检查网络后重试": "Check the network and try again",
    "选择操作": "Choose an action", "请选择本次要办理的车辆流程": "Choose the vehicle workflow to process", "出发": "Departure", "中转": "Transfer", "返回": "Return", "新建调度、登记出发公里数和车况照片": "Create a dispatch and record departure mileage and condition photos", "登记中转地点，保留在同一条调度任务中": "Record the transfer stop and keep it in the same dispatch task", "选择在途任务，登记返程公里数和车况": "Select an active task, then record return mileage and condition", "选择返程车辆": "Choose a returning vehicle", "仅显示尚未完成的调度任务": "Only unfinished dispatches are shown",
    "全部任务": "All tasks", "待处理": "Open", "执行中": "In progress", "已完成": "Completed", "失败": "Failed", "当前调度表": "Current dispatch table", "待调度 / 已排程": "Pending / scheduled", "已发送到执行器": "Sent to executor", "本次同步结果": "Latest sync result", "需要人工关注": "Needs attention",
    "车辆总览": "Fleet overview", "全部": "All", "行政部": "Administration", "维护部": "Maintenance", "运营部": "Operations", "采购部": "Procurement", "仓库部": "Warehouse", "门店部": "Stores", "已售车辆": "Sold vehicles", "添加已售车辆": "Add sold vehicle", "新增已售车辆": "Add sold vehicle", "保存已售车辆": "Save sold vehicle", "已售车辆会标记为不可调度，仅在已售车辆区域显示。": "Sold vehicles are not dispatchable and appear only in the sold vehicles area.", "请选择车辆档案表": "Select a vehicle record table", "已售车辆已添加。": "Sold vehicle added.", "没有已售车辆。": "No sold vehicles.", "全部原始车辆档案": "All source vehicle records", "全部部门 / 门店": "All departments / stores", "未设置部门 / 门店": "Department / store not set", "信息待补全": "Information to complete", "新建调度": "New dispatch", "连接后加载车辆档案。": "Connect to load vehicle records.", "调度任务": "Dispatch tasks", "调度任务列表": "Dispatch task list", "点击一条任务可在右侧时间线定位": "Select a task to locate it in the timeline", "与调度任务联动": "Linked to dispatch tasks", "任务时间线": "Task timeline", "小时": "Hour", "天": "Day", "周": "Week", "月": "Month", "年": "Year", "条任务": "tasks", "搜索任务、地点、车辆、驾驶人": "Search task, location, vehicle or driver", "全部状态": "All statuses", "已预约": "Reserved", "待调度": "Pending", "已排程": "Scheduled", "取消": "Cancelled", "按状态筛选": "Filter by status", "连接后加载任务。": "Connect to load tasks.", "任务 / 驾驶人": "Task / driver", "出发时间": "Departure time", "路线": "Route", "车辆 / 里程": "Vehicle / mileage", "状态": "Status", "结果": "Result", "删除": "Delete",
    "预约会写入调度表并保留在出行记录中；到预约时间后可继续执行出发登记。": "Reservations are saved to the dispatch table and retained in trip records. Continue to departure processing at the reserved time.", "返回后台总览": "Back to administration overview", "预约出发时间": "Reserved departure time", "预约车辆": "Reserved vehicle", "预约状态会在出发前保留为“已预约”。": "The status remains Reserved until departure.", "提交车辆预约": "Submit vehicle reservation", "预约已创建。": "Reservation created.", "正在提交车辆预约…": "Submitting vehicle reservation…", "车辆调度记录查询": "Dispatch trip record search", "按任务、驾驶人、车辆、状态与出发日期查询多维表格中的出行记录。": "Search Base trip records by task, driver, vehicle, status and departure date.", "全部车辆": "All vehicles", "全部驾驶人": "All drivers", "出发日期从": "Departure date from", "至": "to", "连接后加载出行记录。": "Connect to load trip records.", "任务编号": "Task number", "预约 / 出发时间": "Reservation / departure time", "正在读取调度记录…": "Loading dispatch records…", "条匹配记录": "matching records", "查看": "View",
    "返回车辆总览": "Back to fleet overview", "任务编号": "Task number", "提交后由多维表格自动生成": "Generated by Base after submission", "任务编号由多维表格自动生成": "Task number is generated by Base", "驾驶人": "Driver", "请选择公司人员": "Select a company person", "选项来自公司人员": "Options come from the company directory", "当前公里数": "Current mileage", "起点": "Origin", "目的地": "Destination", "返程起点": "Return origin", "返程目的地": "Return destination", "默认从原目的地返回，也可手动修改": "Defaults to the departure destination; editable", "默认返回原起点，也可手动修改": "Defaults to the departure origin; editable", "可手动输入地点或选择门店": "Type a location or choose a store", "快速选择门店": "Quick-select a store", "可直接输入任意地点；门店选项用于快速选择": "Enter any location; store choices are shortcuts", "行程方式": "Trip mode", "直达": "Direct", "中转": "Via transfer", "中转地点": "Transfer stop", "中转门店或其他地点": "Transfer store or other location", "中转任务会保留中转地点，并与返程路线关联": "Transfer tasks keep the transfer stop and link it to the return route", "填写返程起点和目的地，到达后填写返程公里数，并拍摄车辆四面照片。照片不采集地点。": "Enter the return origin and destination, then record mileage and four-side photos. Location is not collected.", "车辆": "Vehicle", "请选择车牌": "Select a plate", "请选择可调度车牌": "Select an available plate", "选择车牌后显示车型描述": "Model description appears after selecting a plate", "车辆公里数和保养里程会自动带出": "Vehicle mileage and maintenance due distance are filled automatically", "下次保养公里数": "Next maintenance mileage", "自动带出，可修改": "Filled automatically; editable", "调度状态": "Dispatch status", "部门通知设置": "Department notification settings", "出发通知": "Departure notification", "返程通知": "Return notification", "预约通知": "Reservation notification", "添加联系人": "Add contact", "添加群聊": "Add group chat", "未设置": "Not set", "保存通知设置": "Save notification settings",
    "出发前车辆照片": "Departure vehicle photos", "照片保持原始分辨率，并添加时间、阶段和方位水印；不采集位置。": "Photos keep their original resolution and include time, stage and direction watermarks; location is not collected.", "前方": "Front", "后方": "Rear", "左侧": "Left side", "右侧": "Right side", "补充照片（可选）": "Extra photo (optional)", "检查结果": "Inspection result", "外观正常": "No visible issues", "发现损伤": "Damage found", "其他": "Other", "照片备注（可选）": "Photo notes (optional)", "记录补充照片或需要关注的车况": "Note extra photos or any condition that needs attention", "创建调度任务": "Create dispatch task", "中转登记": "Transfer record", "提交出发登记": "Submit departure record", "提交中转登记": "Submit transfer record", "取消编辑": "Cancel edit",
    "车辆返程登记": "Vehicle return", "到达公司后填写返程公里数，并拍摄车辆四面照片。照片不采集地点。": "When back at the company, enter return mileage and photograph all four sides. Photos do not collect location.", "返程公里数": "Return mileage", "其他意外损伤": "Other accidental damage", "无损伤可填写“无”": "Enter “None” if there is no damage", "提交返程登记": "Submit return record", "照片只在提交时上传到多维表格附件字段；浏览器不会保存原图，也不会调用定位服务。": "Photos upload to Base only on submission. The browser neither retains originals nor requests location.",
    "车辆档案": "Vehicle record", "查看车辆资料、保养信息和档案完整度。": "Review vehicle information, maintenance and profile completeness.", "编辑车辆资料": "Edit vehicle information", "连接后加载车辆档案。": "Connect to load vehicle records.", "补齐车辆资料后可用于调度和保养提醒。": "Complete vehicle details for dispatch and maintenance reminders.", "返回车辆档案": "Back to vehicle record", "车牌": "Number plate", "车辆品牌": "Vehicle brand", "车型": "Model", "车辆类型": "Vehicle type", "车辆状态": "Vehicle status", "所属门店 / 部门": "Store / department", "年份": "Year", "注册地点": "Registering authority", "上次保养日期": "Last service date", "服务提供商": "Service provider", "备用钥匙": "Spare key", "注册号": "Register number", "车辆 ID / VIN": "Vehicle ID / VIN", "Tracker 匹配": "Tracker match", "自动按 VIN / 车牌匹配": "Match automatically by VIN / plate", "选择已同步的 Tracker 车辆；保存后优先使用这个匹配。": "Choose a synchronized Tracker vehicle; this match is preferred after saving.", "Tracker 数据尚未加载": "Tracker data has not loaded yet", "车辆档案表未配置 Tracker 匹配字段；请先增加 Tracker 文本字段。": "The vehicle table has no Tracker match field; add a Tracker text field first.", "年检到期日期": "Inspection expiry date", "年检状态": "Inspection status", "车辆大本": "Vehicle log book", "车辆大本（可选）": "Vehicle log book (optional)", "大本资料": "Log book details", "查看大本": "View log book", "大本已保存": "Log book saved", "未上传车辆大本": "No vehicle log book uploaded", "不选择新大本时保留现有大本": "The current log book is kept if no replacement is selected", "保单号": "Policy number", "保险信息": "Insurance", "加油油卡号": "Fuel card number", "车辆照片（可选）": "Vehicle photo (optional)", "加油油卡图片（可选）": "Fuel card photo (optional)", "不选择新照片时保留当前车辆照片": "Current vehicle photo is kept if no new one is selected", "不选择新照片时保留当前加油油卡图片": "Current fuel card photo is kept if no new one is selected", "暂无车辆照片": "No vehicle photo", "暂无加油油卡图片": "No fuel card photo", "保存车辆资料": "Save vehicle information", "多维表格选项": "Base options", "右侧选项直接读取车辆档案表；也可手动输入。": "The options on the right come directly from the vehicle table; manual input is also allowed.", "选项来自当前车辆档案表已有车型记录；也可手动输入。": "Options come from models already recorded in this vehicle table; manual input is also allowed.",
    "未填写": "Not entered", "未编号": "Unnumbered", "未分配": "Unassigned", "未分配部门": "No department", "未分配车辆": "No vehicle assigned", "车型未配置": "Model not configured", "未设置": "Not set", "不可调度": "Not dispatchable", "正常": "Normal", "需要保养": "Maintenance due", "下次保养": "Next maintenance", "待补全": "To complete", "车辆资料完整": "Vehicle profile complete", "车辆资料已完整。": "Vehicle profile is complete.", "本表未设置": "Not configured in this table", "未上传": "Not uploaded", "已上传": "Uploaded",
    "年份未填写": "Year not entered", "当前公里数字段": "Current mileage field", "保养里程字段": "Maintenance mileage field", "保养日期字段": "Maintenance date field", "年检到期日期": "Inspection expiry date", "车辆大本": "Vehicle log book", "车辆照片": "Vehicle photo", "车辆照片（可选）": "Vehicle photo (optional)", "加油油卡图片": "Fuel card photo", "加油油卡图片（可选）": "Fuel card photo (optional)", "品牌": "Brand", "所属部门/门店": "Store / department", "未设置部门/门店": "Store / department not set", "状态待确认": "Status to confirm",
    "用此车新建调度": "New dispatch with this vehicle", "不可新建调度": "Dispatch unavailable", "管理车辆": "Manage vehicle", "编辑": "Edit", "填写返程 ›": "Complete return ›", "出发": "Departure", "返程": "Return", "出发前": "Before departure", "驾驶人": "Driver", "当前公里数": "Current mileage", "档案当前": "Current in record", "档案未填写当前公里数": "Current mileage is not entered in the record", "未设置下次保养里程": "Next maintenance mileage is not set", "下次保养公里数": "Next maintenance mileage", "下次保养计划": "Next maintenance plan", "两项需一起填写，提交后同步回车辆档案": "Both fields are required and will sync to the vehicle record", "车辆信息": "Vehicle information", "里程与保养": "Mileage and maintenance", "注册与证件": "Registration and documents", "保险与配套": "Insurance and accessories", "已到保养里程": "Maintenance mileage reached", "保养里程正常": "Maintenance mileage normal", "本表未设置保养里程字段": "No maintenance mileage field in this table", "未填写车牌": "Number plate not entered", "保养确认与保修资料": "Maintenance confirmation and warranty documents", "确认后会回写车辆档案中已存在的保养日期、服务商和公里数字段，并保留历史记录。": "Confirmation updates existing service date, provider and mileage fields in the vehicle record and keeps an audit history.", "保养日期": "Service date", "保养公里数": "Service mileage", "服务提供商": "Service provider", "保修单文档": "Warranty document", "支持 PDF、JPG、PNG、WebP，最大 12 MB": "PDF, JPG, PNG or WebP, up to 12 MB", "保养说明": "Service notes", "记录保养项目、保修范围或其他说明": "Record service items, warranty coverage or other notes", "确认本次保养": "Confirm maintenance", "保养历史": "Maintenance history", "正在读取保养记录…": "Loading maintenance records…", "暂无保养记录。": "No maintenance records.", "保养记录": "Maintenance record", "确认人": "Confirmed by", "已回写字段": "Updated fields", "保修单": "Warranty document", "下载": "Download", "车辆档案照片": "Vehicle profile photo", "建议上传清晰原图；列表使用轻量缩略图，详情页再加载高清图。": "Upload a clear original; lists use a lightweight thumbnail and details load the high-quality image.", "车辆照片需要同时提交原图和缩略图": "The vehicle photo requires both the original and thumbnail.", "保养记录读取失败：": "Maintenance records failed to load: ", "保养确认失败：": "Maintenance confirmation failed: ", "保养已确认。": "Maintenance confirmed.", "文件大小不能超过 12 MB": "The file must be no larger than 12 MB", "请选择有效的保修单文件": "Choose a valid warranty document", "车辆定位": "Vehicle location", "打开 Tracker 定位平台": "Open Tracker location platform", "在 Tracker 平台查看已关联车辆的实时位置。单车地图与自动回传须使用 Tracker 官方 API 凭证。": "View the live location of linked vehicles in Tracker. Per-vehicle maps and automatic sync require official Tracker API credentials.",
    "没有匹配的调度任务。": "No matching dispatch tasks.", "暂无可办理返程的调度任务。": "No return dispatch tasks are available.", "暂无可办理中转的调度任务。": "No transfer dispatch tasks are available.", "已中转": "Transferred", "登记中转 ›": "Record transfer ›", "修改中转 ›": "Edit transfer ›", "更新中转登记": "Update transfer record", "没有读取到车辆档案。": "No vehicle records were found.", "这个部门 / 门店暂无匹配车辆。": "No matching vehicles in this department / store.", "正在读取车辆…": "Loading vehicles…", "车辆选项读取失败，请重试": "Vehicle options failed to load; retry", "提交出发登记": "Submit departure record", "出发登记": "Departure record", "编辑任务": "Edit task", "保存修改": "Save changes", "已加时间水印": "Timestamp watermark added", "正在保存车辆资料…": "Saving vehicle information…", "车辆资料已更新。": "Vehicle information updated.", "车辆资料完整，可用于调度与保养提醒。": "Vehicle profile is complete and ready for dispatch and maintenance reminders.", "编辑车辆资料": "Edit vehicle information", "车辆档案照片": "Vehicle record photo", "新车辆照片预览": "New vehicle photo preview", "新加油油卡图片预览": "New fuel card photo preview",
    "请先连接后端。": "Connect to the backend first.", "请输入后端令牌。": "Enter the backend token.", "请输入后端令牌后连接。": "Enter the backend token, then connect.", "请选择驾驶人": "Select a driver", "输入姓名或英文名匹配": "Type a name or English name to match", "输入姓名或英文名，系统会自动匹配公司人员": "Type a name or English name; the system matches a company person", "已匹配：": "Matched: ", "未匹配到公司人员，请从建议中选择": "No company person matched; choose from the suggestions", "照片": "Photo", "张照片已准备，提交时上传。": "photos ready to upload on submission.", "请补齐前、后、左、右四张照片；补充照片为选填。": "Add front, rear, left and right photos; the extra photo is optional.", "正在读取多维表格…": "Loading Base…", "正在执行同步…": "Syncing…", "读取失败：": "Load failed: ", "同步失败：": "Sync failed: ", "保存失败：": "Save failed: ", "处理照片失败：": "Photo processing failed: ", "无法读取图片": "Unable to read the image", "图片压缩失败": "Image compression failed", "图片转换失败": "Image conversion failed"
  };
  zhToEn["进入 Tracker 官方车辆定位平台查看已关联车辆。当前未接入 Tracker 官方 API，因此不会伪造单车定位参数。"] = "Open the official Tracker vehicle location platform to view linked vehicles. The Tracker official API is not connected, so no per-vehicle parameters are fabricated.";
  zhToEn["已自动关联 Tracker 实时数据；车辆档案表未配置可写 Tracker 字段，当前不会回写编号。"] = "Live Tracker data is linked automatically; the vehicle table has no writable Tracker field, so the registration will not be written back.";
  Object.assign(zhToEn, {
    "Tracker 位置": "Tracker location",
    "在地图中查看": "View on map",
    "车辆实际状态": "Actual vehicle status",
    "未获取": "Unavailable",
    "Tracker 里程": "Tracker odometer",
    "车辆位置状态": "Vehicle location status",
    "查看位置状态": "View location status",
    "Tracker 更新状态": "Tracker update status",
    "数据时间": "Data time",
    "最后同步": "Last sync",
    "更新不足1小时": "Updated less than 1 hour ago",
    "超过24小时未更新 · 需要关注": "No update for more than 24 hours · Needs attention",
    "待确认": "Pending confirmation",
    "Tracker 未匹配": "Tracker not matched",
    "等待 Tracker 自动同步": "Waiting for automatic Tracker sync",
    "最近同步失败，正在显示上一次成功数据。": "The latest sync failed. Showing the last successful snapshot.",
    "发现重复 Tracker 记录，需要管理员核对 VIN 和车牌后确认。": "Duplicate Tracker records were found. An administrator must verify the VIN and plate.",
    "车辆档案 VIN 与 Tracker VIN 不一致，需要管理员确认。": "The vehicle record VIN differs from Tracker. An administrator must confirm it.",
    "Tracker 中暂未找到这辆车。": "This vehicle was not found in Tracker.",
    "位置、里程与数据时间在独立菜单中显示。": "Location, mileage and data time are shown in a dedicated menu.",
    "立即刷新": "Refresh now",
    "刷新已排队": "Refresh queued",
    "正在提交刷新请求…": "Requesting refresh…",
    "Tracker 刷新已排队；系统会在安全间隔到期后执行。": "Tracker refresh is queued and will run after the safety interval.",
    "刷新请求失败：": "Refresh request failed: ",
    "关闭": "Close",
    "打开 Tracker": "Open Tracker",
    "定位数据来自 Tracker 官方车辆列表报告。": "Location data comes from the official Tracker vehicle list report.",
    "定位数据来自 Tracker 官方车辆列表。": "Location data comes from the official Tracker vehicle list."
  });
  Object.assign(zhToEn, {
    "Tracker 回溯": "Tracker history",
    "车辆行驶回溯": "Vehicle movement history",
    "行驶回溯": "Movement history",
    "按车辆、日期时间、位置和车辆实际状态查询 Tracker 更新记录；精确位置仅保存在车辆服务器。": "Query Tracker updates by vehicle, date and time, location and actual vehicle status. Exact locations remain on the vehicle server only.",
    "开始时间": "Start time",
    "结束时间": "End time",
    "位置 / 车牌搜索": "Location / plate search",
    "地址、车牌、VIN": "Address, plate or VIN",
    "如 Ignition Off": "e.g. Ignition Off",
    "排序": "Order",
    "最新在前": "Newest first",
    "最早在前": "Oldest first",
    "每页": "Per page",
    "查询记录": "Search records",
    "重置": "Reset",
    "快速范围": "Quick range",
    "1 小时": "1 hour",
    "2 小时": "2 hours",
    "4 小时": "4 hours",
    "6 小时": "6 hours",
    "12 小时": "12 hours",
    "24 小时": "24 hours",
    "7 天": "7 days",
    "30 天": "30 days",
    "90 天": "90 days",
    "查看大概路线": "View approximate route",
    "Tracker 时间": "Tracker time",
    "位置": "Location",
    "里程": "Mileage",
    "记录时间": "Recorded at",
    "加载更多": "Load more",
    "全部可访问车辆": "All accessible vehicles",
    "暂无查询结果。": "No matching records.",
    "请选择条件查询 Tracker 记录。": "Choose filters to search Tracker records.",
    "快速时间范围": "Quick time range",
    "50 条": "50 records", "100 条": "100 records", "250 条": "250 records", "500 条": "500 records",
    "查询起止时间无效。": "The query time range is invalid.",
    "正在查询 Tracker 历史记录…": "Searching Tracker history…",
    "Tracker 历史查询失败：": "Tracker history query failed: "
  });
  Object.assign(zhToEn, {
    "一键标记为已售": "Mark as sold",
    "确定将这台车辆标记为已售吗？标记后车辆将从可调度车辆中移除。": "Mark this vehicle as sold? It will be removed from dispatchable vehicles.",
    "正在标记车辆为已售…": "Marking vehicle as sold…",
    "车辆已标记为已售。": "Vehicle marked as sold.",
    "标记已售失败：": "Mark sold failed: ",
    "请选择保险状态": "Select insurance status",
    "保险信息现在只能从多维表格同步的 YES / NO 中选择。": "Insurance can now only be selected from the YES / NO options synced from Base."
  });
  Object.assign(zhToEn, {
    "直接删除车辆": "Delete vehicle",
    "正在删除车辆档案…": "Deleting vehicle record…",
    "车辆档案已删除。": "Vehicle record deleted.",
    "删除车辆档案失败：": "Delete vehicle record failed: "
  });
  zhToEn["待填写日期"] = "Date not set";
  zhToEn["下次保养日期"] = "Next maintenance date";
  zhToEn["保养日期字段"] = "Maintenance date field";
  Object.assign(zhToEn, { "自动模式": "Auto mode", "日间模式": "Day mode", "夜间模式": "Night mode", "跳到主内容": "Skip to main content", "查看出行记录": "View trip records", "保养状态": "Maintenance status", "默认当前登录人，可改选其他人员": "Defaults to the signed-in user; other personnel can be selected", "移动调度默认显示全部可调度车辆，也可按部门筛选；仅显示可调度车辆。": "Mobile dispatch shows all dispatchable vehicles by default; filter by department when needed.", "权限管理": "Permission settings", "返回选择返程任务": "Back to return task list", "返回选择中转任务": "Back to transfer task list" });
  Object.assign(zhToEn, { "未选择任务": "No task selected", "点击左侧任务查看详情、操作和时间线。": "Select a task to review its details, actions and timeline.", "任务结果": "Task result", "任务检查器": "Task inspector", "选择任务后在右侧查看处理上下文和时间线": "Select a task to review its context and timeline on the right" });
  const enToZh = Object.fromEntries(Object.entries(zhToEn).map(([zh, en]) => [en, zh]));
  const zhEntries = Object.entries(zhToEn).sort((a, b) => b[0].length - a[0].length);
  const enEntries = Object.entries(enToZh).sort((a, b) => b[0].length - a[0].length);
  function t(value) { const text = String(value ?? ""); return state.language === "en" ? (zhToEn[text] || text) : (enToZh[text] || text); }
  function localizeMessage(value) {
    return (state.language === "en" ? zhEntries : enEntries).reduce((text, [from, to]) => text.split(from).join(to), String(value ?? ""));
  }
  function translateTextNode(node) {
    if (node.parentElement?.closest("#vehicleCards,#taskRows,#returnTaskList,#vehicleDetailContent")) return;
    const source = node.nodeValue ?? "";
    const leading = source.match(/^\s*/)?.[0] || ""; const trailing = source.match(/\s*$/)?.[0] || "";
    const content = source.trim(); if (content) node.nodeValue = `${leading}${localizeMessage(content)}${trailing}`;
  }
  function translateAttribute(element, attribute) {
    const source = element.getAttribute(attribute) ?? "";
    if (source) element.setAttribute(attribute, localizeMessage(source));
  }
  function translateStaticContent(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateTextNode);
    root.querySelectorAll("[placeholder],[aria-label]").forEach((element) => { if (element.closest("#vehicleCards,#taskRows,#returnTaskList,#vehicleDetailContent")) return; if (element.hasAttribute("placeholder")) translateAttribute(element, "placeholder"); if (element.hasAttribute("aria-label")) translateAttribute(element, "aria-label"); });
  }

  if (isMobile) {
    document.body.classList.add("apply-view");
    if (isReturnOnly) document.body.classList.add("return-mode");
    document.title = view === "return" ? "移动设备调度 · 返回" : view === "departure" ? "移动设备调度 · 出发" : isTransferView ? "移动设备调度 · 中转" : "移动设备调度";
    $("appTitle").textContent = "移动设备调度";
    $("appSubtitle").textContent = "仅用于车辆出发、中转与返回登记";
    $("viewSwitch").textContent = "桌面调度台";
    $("viewSwitch").href = "/?view=overview";
    $("backToOverviewButton").textContent = "返回选择操作";
  }

  function setNotice(message, kind = "") { notice.textContent = localizeMessage(message); notice.className = `notice ${kind}`.trim(); }
  function setAppLoading(title, detail) {
    if (appLoadingTitle && title) appLoadingTitle.textContent = localizeMessage(title);
    if (appLoadingDetail && detail) appLoadingDetail.textContent = localizeMessage(detail);
  }
  function hideAppLoading() {
    appReady = true;
    document.documentElement.classList.remove("app-booting");
    if (!appLoadingOverlay) return;
    appLoadingOverlay.classList.remove("is-visible");
    const hideTimer = window.setTimeout(() => appLoadingOverlay.setAttribute("hidden", ""), 220);
    appLoadingOverlay.dataset.hideTimer = String(hideTimer);
  }
  function showAppLoading() {
    document.documentElement.classList.add("app-booting");
    if (!appLoadingOverlay) return;
    if (appLoadingOverlay.dataset.hideTimer) window.clearTimeout(Number(appLoadingOverlay.dataset.hideTimer));
    delete appLoadingOverlay.dataset.hideTimer;
    appLoadingOverlay.removeAttribute("hidden");
    appLoadingOverlay.classList.add("is-visible");
  }
  function setInlineStatus(element, message, kind = "") { if (!element) return; element.setAttribute("aria-live", "polite"); element.setAttribute("aria-atomic", "true"); element.textContent = localizeMessage(message); element.className = `field-hint ${kind}`.trim(); }
  function setBookingSubmitBusy(isBusy) {
    const button = bookingForm?.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = isBusy;
    button.setAttribute("aria-busy", String(isBusy));
    if (isBusy) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = t("正在提交车辆预约…");
    } else if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }
  function markFormDirty() { state.hasUnsavedChanges = true; }
  function clearFormDirty() { state.hasUnsavedChanges = false; }
  function prefersReducedMotion() { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; }
  function contextualScrollBehavior() { return prefersReducedMotion() || scrollPerformanceDevice ? "auto" : "smooth"; }
  function playFeedback(element, keyframes, duration) {
    if (scrollPerformanceDevice) return;
    if (!element?.animate) return;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(keyframes, { duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "none" });
  }
  function playConfirmationFeedback(element) {
    const reduced = prefersReducedMotion();
    playFeedback(element, reduced ? [{ opacity: 0.55 }, { opacity: 1 }] : [{ opacity: 0.55, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }], reduced ? 200 : 180);
  }
  function playTaskInspectorFeedback(element) {
    const reduced = prefersReducedMotion();
    playFeedback(element, reduced ? [{ opacity: 0.72 }, { opacity: 1 }] : [{ opacity: 0.72, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }], reduced ? 160 : 140);
  }
  function playTimelineRefreshFeedback(element) { playFeedback(element, [{ opacity: 0.72 }, { opacity: 1 }], 160); }
  function headers() { return { "Content-Type": "application/json", "X-Dispatch-Client": isMobile ? "mobile" : "desktop" }; }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
  function cleanDisplay(value) { return String(value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim(); }
  function dateInputValue(value) {
    const text = String(value ?? "").trim();
    const prefix = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (prefix) return prefix;
    const numeric = Number(text);
    // Some empty Lark date cells are represented as 0. Do not show them as
    // 1970-01-01 or send that accidental value back on the next save.
    if (Number.isFinite(numeric) && numeric <= 0) return "";
    const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(text);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  function vehicleEditorFingerprint() {
    return JSON.stringify({
      plate: $("vehiclePlateInput").value,
      brand: $("vehicleBrandInput").value,
      model: $("vehicleModelInput").value,
      vehicleType: $("vehicleTypeInput").value,
      status: $("vehicleStatusInput").value,
      owner: $("vehicleOwnerInput").value,
      year: $("vehicleYearInput").value,
      registeringAuthority: $("vehicleRegisteringAuthorityInput").value,
      lastServiceDate: $("vehicleLastServiceDateInput").value,
      nextMaintenanceDate: $("vehicleNextMaintenanceDateInput").value,
      serviceProvider: $("vehicleServiceProviderInput").value,
      spareKey: $("vehicleSpareKeyInput").value,
      registerNumber: $("vehicleRegisterNumberInput").value,
      vehicleIdentificationNumber: $("vehicleIdentificationNumberInput").value,
      trackerRegistration: $("vehicleTrackerInput").value,
      certificateExpiry: $("vehicleCertificateExpiryInput").value,
      policyNumber: $("vehiclePolicyNumberInput").value,
      insurance: $("vehicleInsuranceInput").value,
      fnbFleetCard: $("vehicleFnbFleetCardInput").value,
      mileage: $("vehicleMileageInput").value,
      nextMaintenanceMileage: $("vehicleNextMaintenanceInput").value,
      hasProfilePhoto: Boolean(state.vehiclePhotoFullDataUrl),
      logBookFileName: state.logBookDocument?.fileName || "",
      hasFleetCardPhoto: Boolean(state.fleetCardPhotoDataUrl)
    });
  }
  function formatDate(value) { if (!value) return t("未填写"); const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(state.language === "en" ? "en-GB" : "zh-CN", { hour12: false }); }
  function formatMileage(value) { return value === null || value === undefined || value === "" ? t("未填写") : `${Number(value).toLocaleString(state.language === "en" ? "en-GB" : "zh-CN")} km`; }
  function maintenanceClass(value) { const text = String(value || ""); if (text.includes("需") || text.includes("超") || text.includes("提醒")) return "maintenance-warn"; if (text.includes("正常")) return "maintenance-ok"; return ""; }
  function statusClass(status) { if (status === "已完成") return "status-done"; if (status === "失败") return "status-failed"; if (status === "取消") return "status-cancelled"; if (status === "执行中") return "status-running"; return "status-pending"; }
  function vehicleByPlate(plate) { return state.vehicles.find((vehicle) => vehicle.plate === plate) || null; }
  function selectedPerson(select) { const option = select.options[select.selectedIndex]; return option?.value || ""; }
  function normalizeMatch(value) { return cleanDisplay(value).toLocaleLowerCase().replace(/[·|,，()（）]/g, " ").replace(/\s+/g, " ").trim(); }
  function userLabel(user) { return user.enName && user.enName !== user.name ? `${user.name} · ${user.enName}` : user.name; }
  function currentUserOption() {
    const principal = state.user;
    if (!principal) return null;
    const identity = [principal.larkOpenId, principal.username].filter(Boolean).map(normalizeMatch);
    const display = [principal.displayName, principal.username].filter(Boolean).map(normalizeMatch);
    return state.users.find((user) => identity.includes(normalizeMatch(user.id))) || state.users.find((user) => [user.name, user.enName, userLabel(user)].some((value) => display.includes(normalizeMatch(value)))) || null;
  }
  function setDefaultRequester(selectId, inputId, statusId) {
    const select = $(selectId); const input = $(inputId);
    if (!select || !input || select.value || input.value.trim()) return;
    const user = currentUserOption();
    if (!user) return;
    select.value = user.id;
    input.value = userLabel(user);
    input.setCustomValidity("");
    updateRequesterMatchStatus(inputId, selectId, statusId);
  }
  function departmentKey(value) {
    const normalized = normalizeMatch(value);
    if (!normalized) return "";
    return vehicleDepartmentOptions.find(([key, label]) => {
      const keyText = normalizeMatch(key); const labelText = normalizeMatch(label);
      return normalized === keyText || normalized === labelText || normalized.includes(keyText) || normalized.includes(labelText);
    })?.[0] || "";
  }
  function setDefaultVehicleDepartment(select) {
    if (!select || select.dataset.departmentTouched === "true" || select.value) return;
    // Mobile dispatchers can choose a vehicle from any department. Start with
    // the complete eligible list and keep the department selector as a filter.
    if (isMobile) return;
    const user = currentUserOption();
    const department = departmentKey(user?.department || state.user?.department || "");
    if (department && vehicleDispatchDepartmentOptions.some(([value]) => value === department)) select.value = department;
  }
  function findUserByInput(value) {
    const query = normalizeMatch(value);
    if (!query) return null;
    const exact = state.users.filter((user) => [user.name, user.enName, userLabel(user), user.id].some((candidate) => normalizeMatch(candidate) === query));
    if (exact.length === 1) return exact[0];
    const partial = state.users.filter((user) => [user.name, user.enName, userLabel(user)].some((candidate) => normalizeMatch(candidate).includes(query)));
    return partial.length === 1 ? partial[0] : null;
  }
  function syncRequesterInput(selectId, inputId) {
    const select = $(selectId); const input = $(inputId); if (!select || !input) return;
    const user = state.users.find((item) => item.id === select.value);
    if (user) input.value = userLabel(user);
  }
  function updateRequesterMatchStatus(inputId, selectId, statusId) {
    const input = $(inputId); const select = $(selectId); const status = $(statusId); if (!input || !select || !status) return;
    const user = state.users.find((item) => item.id === select.value);
    if (!input.value.trim()) { setInlineStatus(status, "输入姓名或英文名，系统会自动匹配公司人员"); return; }
    setInlineStatus(status, user ? `已匹配：${userLabel(user)}` : "未匹配到公司人员，请从建议中选择", user ? "success" : "error");
  }
  function matchRequesterInput(inputId, selectId, statusId) {
    const input = $(inputId); const select = $(selectId); if (!input || !select) return;
    const user = findUserByInput(input.value);
    select.value = user?.id || "";
    input.setCustomValidity(input.value.trim() && !user ? "请从匹配结果中选择有效的公司人员" : "");
    updateRequesterMatchStatus(inputId, selectId, statusId);
  }
  function renderRequesterSuggestions(inputId, datalistId) {
    const datalist = $(datalistId); if (!datalist) return;
    const values = [];
    state.users.forEach((user) => [user.name, user.enName, userLabel(user)].forEach((value) => { if (value && !values.includes(value)) values.push(value); }));
    datalist.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  }
  function positionLabel(position) { return t(({ front: "前方", rear: "后方", left: "左侧", right: "右侧", extra: "补充照片" })[position] || position); }

  function showOnly(name) {
    const views = [
      ["overviewView", "overview"], ["bookingView", "booking"], ["historyView", "history"], ["trackerHistoryView", "trackerHistory"],
      ["editorView", "editor"], ["vehicleDetailView", "vehicleDetail"], ["vehicleEditorView", "vehicleEditor"],
      ["vehicleOptionsView", "vehicleOptions"], ["settingsView", "settings"], ["mobileHome", "mobile"],
      ["returnPicker", "returnPicker"], ["transferPicker", "transferPicker"], ["statsView", "overview"]
    ];
    const target = views.find(([, viewName]) => viewName === name)?.[0];
    const update = () => views.forEach(([id, viewName]) => { $(id).hidden = viewName !== name; });
    if (target && !$(target).hidden && document.startViewTransition) return null;
    if (!scrollPerformanceDevice && document.startViewTransition) return document.startViewTransition(update);
    update();
    return null;
  }

  function resetPageScroll() {
    const reset = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    reset();
    window.requestAnimationFrame(reset);
  }

  function showOverview() {
    if (isMobile) {
      history.pushState(null, "", "?view=apply");
      showMobileHome();
      return;
    }
    document.body.classList.remove("editor-mode");
    showOnly("overview");
    history.replaceState(null, "", "?view=overview");
  }

  function openBooking() {
    document.body.classList.remove("editor-mode");
    showOnly("booking");
    resetBooking();
    history.replaceState(null, "", "?view=booking");
  }

  function openHistory() {
    if (isMobile) { window.location.href = "/?view=history"; return; }
    document.body.classList.remove("editor-mode");
    showOnly("history");
    renderHistory();
    history.replaceState(null, "", "?view=history");
  }


  function showMobileHome() {
    state.mobileFlow = "apply";
    document.body.classList.remove("editor-mode", "return-mode");
    showOnly("mobile");
  }

  function showReturnPicker() {
    state.mobileFlow = "return";
    document.body.classList.remove("editor-mode", "return-mode");
    showOnly("returnPicker");
    renderReturnPicker();
  }

  function showTransferPicker() {
    state.mobileFlow = "transfer";
    document.body.classList.remove("editor-mode", "return-mode");
    showOnly("transferPicker");
    renderTransferPicker();
  }

  function applyLanguage() {
    const english = state.language === "en";
    document.documentElement.lang = english ? "en" : "zh-CN";
    document.body.dataset.language = state.language;
    document.title = isMobile ? t(view === "return" ? "移动设备调度 · 返回" : view === "departure" ? "移动设备调度 · 出发" : isTransferView ? "移动设备调度 · 中转" : "移动设备调度") : t("车辆调度控制台");
    $("languageToggle").textContent = english ? "中文" : "English";
    $("languageToggle").setAttribute("aria-label", english ? "Switch to Chinese" : "切换为英文");
    translateStaticContent();
    renderOptions(); renderVehicleDepartmentFilter(); renderVehicles(); renderRows(); renderBookingTable(); renderReturnPicker(); renderTransferPicker(); renderHistory(); renderTrackerHistoryVehicleOptions(); renderTrackerHistoryRows();
    if (trackerVehicleDialog?.open && state.trackerVehicleKey) renderTrackerDialog();
    if (!$('vehicleDetailView').hidden && state.editingVehicle) renderVehicleDetail(state.editingVehicle);
    if (!$('editorView').hidden) { localizeEditorChrome(); updateVehicleReadout(); }
    if (!$('vehicleEditorView').hidden) { renderVehicleEditorOptions(); if (state.editingVehicle) localizeVehicleEditorChrome(); }
    if (!$('vehicleOptionsView').hidden) renderVehicleOptionDefinitions();
  }

  function userCan(permission) {
    return Boolean(state.user?.permissions?.includes(permission));
  }

  function roleLabel(role) {
    return t(({ admin: "管理员", scheduler: "排程员", fleet_manager: "车队管理员", dispatcher: "调度员" })[role] || "调度员");
  }

  function applyAccess() {
    if (!state.user) return;
    $("accountName").textContent = state.user.displayName || state.user.username;
    $("accountRole").textContent = roleLabel(state.user.role);
    $("accountManagementLink").hidden = !userCan("manage_accounts");
    $("notificationSettingsLink").hidden = !userCan("manage_notifications");
    $("vehicleOptionsLink").hidden = !userCan("manage_vehicles");
    $("vehicleOptionsOverviewLink").hidden = !userCan("manage_vehicles");
    $("syncButton").hidden = !userCan("sync_dispatch");
    $("editVehicleButton").hidden = !userCan("manage_vehicles");
    $("deleteVehicleDetailButton").hidden = !userCan("manage_vehicles");
    $("addSoldVehicleButton").hidden = !userCan("manage_vehicles");
    $("reservationLink").hidden = !userCan("desktop_console");
    $("historyLink").hidden = !userCan("view_history");
    $("trackerHistoryLink").hidden = !userCan("view_tracker_history");
    $("bookingAdminPanel").hidden = !userCan("approve_bookings");
    $("photoSyncConnectButton").hidden = !userCan("manage_photo_sync");
    $("photoSyncConnectButton").closest("article")?.toggleAttribute("hidden", !userCan("manage_photo_sync"));
    $("notificationSettingsContent")?.closest("article")?.toggleAttribute("hidden", !userCan("manage_notifications"));
    $("vehicleMaintenancePanel").hidden = !userCan("manage_maintenance");
    $("trackerRefreshButton").hidden = !userCan("refresh_tracker");
    $("formSubmitButton").hidden = view === "departure" ? !userCan("submit_departure") : (!userCan("create_dispatch") && !userCan("edit_own_dispatch") && !userCan("edit_all_dispatch"));
    $("transferSubmitButton").hidden = !userCan("submit_transfer");
    $("returnSubmitButton").hidden = !userCan("submit_return");
    if (isMobile) {
      ["accountManagementLink", "notificationSettingsLink", "viewSwitch", "reservationLink", "historyLink", "trackerHistoryLink", "syncButton"].forEach((id) => { if ($(id)) $(id).hidden = true; });
    } else if (!userCan("desktop_console")) {
      window.location.replace("/?view=apply");
    }
  }

  async function loadCurrentUser() {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`${isMobile ? "/login" : "/admin-login"}?next=${encodeURIComponent(next)}`);
      return false;
    }
    const payload = await response.json();
    state.user = payload.user;
    applyAccess();
    return true;
  }

  async function loadPhotoSyncStatus() {
    if (!userCan("manage_photo_sync") || !photoSyncStatus) return;
    try {
      const response = await fetch("/api/admin/lark-photo-sync/status");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法读取同步状态");
      state.photoSync = payload.sync;
      const query = new URLSearchParams(window.location.search);
      if (query.get("photo_sync") === "connected") {
        setInlineStatus(photoSyncStatus, "飞书照片同步已连接：现在上传车辆照片会同步保存到多维表格附件列。", "success");
      } else if (query.get("photo_sync_error")) {
        setInlineStatus(photoSyncStatus, `飞书照片同步未完成：${query.get("photo_sync_error")}`, "error");
      } else if (payload.sync.active) {
        setInlineStatus(photoSyncStatus, `已连接飞书 Base 管理员：${payload.sync.authorizedBy || "已授权管理员"}。车辆照片会同步保存到多维表格。`, "success");
      } else if (payload.sync.connected) {
        setInlineStatus(photoSyncStatus, "已保存的飞书照片同步授权需要刷新；保存照片时会自动刷新，若失败请重新连接。", "");
      } else {
        setInlineStatus(photoSyncStatus, "尚未连接飞书 Base 管理员。未连接时，上传车辆照片不会保存。", "error");
      }
    } catch (error) {
      setInlineStatus(photoSyncStatus, `读取飞书照片同步状态失败：${error.message}`, "error");
    }
  }

  async function loadTrackerStatus() {
    try {
      const response = await fetch("/api/tracker/status", { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.trackerStatus = payload.trackerStatus || null;
      renderVehicles();
      if (!$("vehicleEditorView").hidden) renderVehicleTrackerOptions();
      if (!$('vehicleDetailView').hidden && state.editingVehicle) renderVehicleDetail(state.editingVehicle);
      if (trackerVehicleDialog?.open && state.trackerVehicleKey) renderTrackerDialog();
    } catch (error) {
      console.warn("Tracker status load failed:", error.message);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", headers: headers() });
    window.location.replace(entryMode === "desktop" || (!entryMode && (desktopEnvironment || !isMobile)) ? "/admin-login" : "/login");
  }

  function visibleTasks() {
    const keyword = searchInput?.value.trim().toLowerCase() || "";
    const status = statusFilter?.value || "";
    const quickStatus = state.quickStatusFilter;
    return state.tasks.filter((task) => {
      const model = vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || "";
      const text = [task.taskNumber, task.requester, task.origin, task.transferLocation, task.destination, task.vehicle, model, task.mileage, task.returnMileage, task.maintenanceReminder, task.status, task.result].join(" ").toLowerCase();
      const pending = ["已预约", "待调度", "已排程"].includes(task.status);
      return (quickStatus === "__pending__" ? pending : status ? task.status === status : task.status !== "取消") && (!keyword || text.includes(keyword));
    });
  }

  function taskRoute(task, phase = "departure") {
    if (phase === "return") return [task.returnOrigin || task.transferLocation || task.destination, task.returnDestination || task.origin].filter(Boolean).join(" → ");
    const stops = task.tripMode === "中转" && task.transferLocation ? [task.origin, task.transferLocation, task.destination] : [task.origin, task.destination];
    return stops.filter(Boolean).join(" → ");
  }

  function isOwnTask(task) {
    const principal = state.user || {};
    const same = (left, right) => cleanDisplay(left).toLocaleLowerCase() === cleanDisplay(right).toLocaleLowerCase();
    return Boolean((principal.larkOpenId && task.requesterId && same(principal.larkOpenId, task.requesterId)) || (principal.displayName && task.requester && same(principal.displayName, task.requester)));
  }

  function isDepartedTask(task) {
    if (["已预约", "待调度", "已排程", "已完成", "失败", "取消"].includes(task.status)) return false;
    if (task.stage === "已返程") return false;
    return task.status === "执行中"
      || task.status === "已出发"
      || ["已出发", "返程待登记"].includes(task.stage)
      || (Array.isArray(task.departurePhotos) && task.departurePhotos.length > 0);
  }

  function renderStats() {
    const count = (status) => state.tasks.filter((task) => task.status === status).length;
    $("totalCount").textContent = state.tasks.length;
    $("pendingCount").textContent = count("已预约") + count("待调度") + count("已排程");
    $("runningCount").textContent = count("执行中");
    $("doneCount").textContent = count("已完成");
    $("failedCount").textContent = count("失败");
  }

  function renderRows() {
    if (!rows) return;
    const tasks = visibleTasks();
    if (!tasks.some((task) => task.recordId === state.selectedTaskId)) state.selectedTaskId = "";
    if (!tasks.length) { rows.innerHTML = `<tr><td colspan="5" class="empty">${t("没有匹配的调度任务。")}</td></tr>`; renderTaskInspector(); renderTimeline(); return; }
    rows.innerHTML = tasks.map((task) => {
      const model = vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || t("车型未配置");
      const colon = state.language === "en" ? ": " : "：";
      const selected = task.recordId === state.selectedTaskId;
      return `<tr class="task-row${selected ? " task-row-selected" : ""}" data-task-record="${escapeHtml(task.recordId)}" aria-selected="${selected}" tabindex="0"><td><div class="task-id">${escapeHtml(task.taskNumber || t("未编号"))}</div><div class="task-meta">${t("驾驶人")}${colon}${escapeHtml(task.requester || t("未填写"))}</div></td><td>${escapeHtml(formatDate(task.departureTime))}</td><td class="route">${escapeHtml(taskRoute(task) || "—")}</td><td><span class="vehicle">${escapeHtml(task.vehicle || t("未分配"))}</span><span class="driver">${escapeHtml(model)}</span><span class="mileage">${t("出发")} ${escapeHtml(formatMileage(task.mileage))}${task.returnMileage !== null ? ` · ${t("返程")} ${escapeHtml(formatMileage(task.returnMileage))}` : ""}</span>${task.maintenanceReminder ? `<span class="maintenance ${maintenanceClass(task.maintenanceReminder)}">${escapeHtml(t(task.maintenanceReminder))}</span>` : ""}</td><td><span class="badge ${statusClass(task.status)}">${escapeHtml(t(task.status || "未设置"))}</span>${task.stage ? `<span class="stage-label">${escapeHtml(t(task.stage))}</span>` : ""}</td></tr>`;
    }).join("");
    renderTaskInspector();
    renderTimeline();
  }

  function renderTaskInspector() {
    const title = $("taskInspectorTitle");
    const status = $("taskInspectorStatus");
    const details = $("taskInspectorDetails");
    const actions = $("taskInspectorActions");
    if (!title || !status || !details || !actions) return;
    const task = state.tasks.find((item) => item.recordId === state.selectedTaskId);
    if (!task) {
      title.textContent = t("未选择任务");
      status.innerHTML = "";
      details.innerHTML = `<p class="task-inspector-empty">${escapeHtml(t("点击左侧任务查看详情、操作和时间线。"))}</p>`;
      actions.innerHTML = "";
      state.lastInspectedTaskId = "";
      return;
    }
    const selectionChanged = task.recordId !== state.lastInspectedTaskId;
    const model = vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || t("车型未配置");
    const editAction = userCan("edit_all_dispatch") || userCan("edit_own_dispatch") ? `<button class="action-link" data-inspector-edit="${escapeHtml(task.recordId)}">${t("编辑")}</button>` : "";
    const returnAction = userCan("submit_return") ? `<button class="action-link" data-inspector-return="${escapeHtml(task.recordId)}">${t("返程")}</button>` : "";
    const deleteAction = userCan("delete_dispatch") ? `<button class="action-link danger-link" data-inspector-delete="${escapeHtml(task.recordId)}">${t("删除")}</button>` : "";
    title.textContent = task.taskNumber || t("未编号");
    status.innerHTML = `<span class="badge ${statusClass(task.status)}">${escapeHtml(t(task.status || "未设置"))}</span>`;
    details.innerHTML = `<div><span>${t("路线")}</span><strong>${escapeHtml(taskRoute(task) || "—")}</strong></div><div><span>${t("驾驶人")}</span><strong>${escapeHtml(task.requester || t("未填写"))}</strong></div><div><span>${t("车辆")}</span><strong>${escapeHtml(task.vehicle || t("未分配"))} · ${escapeHtml(model)}</strong></div><div><span>${t("出发时间")}</span><strong>${escapeHtml(formatDate(task.departureTime))}</strong></div><div><span>${t("任务结果")}</span><strong>${escapeHtml(task.result || task.error || "—")}</strong></div>`;
    actions.innerHTML = `${editAction}${returnAction}${deleteAction}`;
    state.lastInspectedTaskId = task.recordId;
    if (selectionChanged) playTaskInspectorFeedback(title.closest(".task-inspector-summary"));
  }

  function bookingAdminTasks() {
    return state.tasks.filter((task) => task.status === "已预约" || String(task.result || "").startsWith("预约"))
      .sort((left, right) => new Date(left.departureTime || 0).getTime() - new Date(right.departureTime || 0).getTime());
  }

  function renderBookingTable() {
    if (!bookingRows || !userCan("approve_bookings")) return;
    const tasks = bookingAdminTasks();
    if (!tasks.length) {
      bookingRows.innerHTML = `<tr><td colspan="6" class="empty">${t("暂无车辆预约。")}</td></tr>`;
      return;
    }
    bookingRows.innerHTML = tasks.map((task) => {
      const pending = task.status === "已预约";
      const actions = pending
        ? `<button class="action-link booking-approve" data-booking-approve="${escapeHtml(task.recordId)}">${t("同意并排程")}</button><button class="action-link danger-link" data-booking-reject="${escapeHtml(task.recordId)}">${t("拒绝")}</button>`
        : "—";
      return `<tr><td><strong>${escapeHtml(task.requester || t("未填写"))}</strong><div class="task-meta">${escapeHtml(task.taskNumber || t("未编号"))}</div></td><td>${escapeHtml(formatDate(task.departureTime))}</td><td class="route">${escapeHtml(taskRoute(task) || "—")}</td><td>${escapeHtml(task.vehicle || t("未分配"))}</td><td><span class="badge ${statusClass(task.status)}">${escapeHtml(t(task.status || "未设置"))}</span><span class="stage-label">${escapeHtml(task.result || "")}</span></td><td class="row-actions">${actions}</td></tr>`;
    }).join("");
  }

  function timelineDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function timelineTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function timelineBucket(date, scale) {
    const local = new Date(date);
    if (scale === "hour") return `${timelineDateKey(local)}T${String(local.getHours()).padStart(2, "0")}:00`;
    if (scale === "week") {
      const monday = new Date(local.getFullYear(), local.getMonth(), local.getDate());
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      return timelineDateKey(monday);
    }
    if (scale === "month") return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}`;
    if (scale === "year") return String(local.getFullYear());
    return timelineDateKey(local);
  }

  function timelineLabel(key, scale) {
    if (key === "__undated__") return t("待填写日期");
    if (scale === "year" || scale === "month") return key;
    if (scale === "hour") return key.replace("T", " ");
    if (scale === "week") return `${key} · ${t("周")}`;
    return key;
  }

  function renderTimeline({ feedback = false } = {}) {
    if (!taskTimeline) return;
    const dateFrom = $("timelineDateFrom")?.value || "";
    const dateTo = $("timelineDateTo")?.value || "";
    const tasks = visibleTasks().filter((task) => {
      if (!dateFrom && !dateTo) return true;
      const date = task.departureTime ? timelineDateKey(task.departureTime) : "";
      return Boolean(date && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo));
    });
    const timelineCount = $("timelineTaskCount");
    const datedTasks = tasks.filter((task) => task.departureTime && !Number.isNaN(new Date(task.departureTime).getTime()));
    const undatedTasks = tasks.filter((task) => !task.departureTime || Number.isNaN(new Date(task.departureTime).getTime()));
    if (timelineCount) timelineCount.textContent = `${tasks.length} ${t("条任务")} · ${t("与调度任务联动")}${undatedTasks.length ? ` · ${undatedTasks.length} ${t("待填写日期")}` : ""}`;
    const groups = new Map();
    datedTasks.forEach((task) => {
      const key = timelineBucket(task.departureTime, state.timelineScale);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(task);
    });
    if (undatedTasks.length) groups.set("__undated__", undatedTasks);
    if (!groups.size) { taskTimeline.innerHTML = `<div class="empty-card">${t("没有匹配的调度任务。")}</div>`; if (feedback) playTimelineRefreshFeedback(taskTimeline); return; }
    taskTimeline.innerHTML = [...groups.entries()].sort((a, b) => (a[0] === "__undated__" ? 1 : b[0] === "__undated__" ? -1 : a[0].localeCompare(b[0]))).map(([key, groupedTasks]) => `<section class="timeline-group"><div class="timeline-group-heading"><strong>${escapeHtml(timelineLabel(key, state.timelineScale))}</strong><small>${groupedTasks.length} ${t("条任务")}</small></div><div class="timeline-items">${groupedTasks.sort((a, b) => { const left = a.departureTime ? new Date(a.departureTime).getTime() : Number.POSITIVE_INFINITY; const right = b.departureTime ? new Date(b.departureTime).getTime() : Number.POSITIVE_INFINITY; return left - right; }).map((task) => `<button type="button" class="timeline-item${task.recordId === state.selectedTaskId ? " timeline-item-selected" : ""}" data-timeline-record="${escapeHtml(task.recordId)}" aria-pressed="${task.recordId === state.selectedTaskId}"><span class="timeline-date">${escapeHtml(task.departureTime ? timelineDateKey(task.departureTime) : t("待填写日期"))}</span><span class="timeline-time">${escapeHtml(task.departureTime ? timelineTimeLabel(task.departureTime) : "—")}</span><strong>${escapeHtml(task.taskNumber || t("未编号"))} · ${escapeHtml(task.vehicle || t("未分配"))}</strong><small>${escapeHtml(taskRoute(task) || "—")} · ${escapeHtml(task.requester || t("未填写"))}</small><i class="badge ${statusClass(task.status)}">${escapeHtml(t(task.status || "未设置"))}</i></button>`).join("")}</div></section>`).join("");
    if (feedback) playTimelineRefreshFeedback(taskTimeline);
  }

  function selectTaskInWorkspace(recordId, source) {
    if (!state.tasks.some((task) => task.recordId === recordId)) return;
    state.selectedTaskId = recordId;
    renderRows();
    const selector = source === "timeline" ? `tr[data-task-record="${CSS.escape(recordId)}"]` : `button[data-timeline-record="${CSS.escape(recordId)}"]`;
    document.querySelector(selector)?.scrollIntoView({ behavior: contextualScrollBehavior(), block: "nearest", inline: "nearest" });
  }

  function historyTasks() {
    const keyword = historySearchInput?.value.trim().toLowerCase() || "";
    const vehicle = historyVehicleFilter?.value || "";
    const requester = historyRequesterFilter?.value || "";
    const status = historyStatusFilter?.value || "";
    const dateFrom = historyDateFrom?.value || "";
    const dateTo = historyDateTo?.value || "";
    return state.tasks.filter((task) => {
      const taskDate = task.departureTime ? new Date(task.departureTime) : null;
      const dateText = taskDate && !Number.isNaN(taskDate.getTime()) ? taskDate.toISOString().slice(0, 10) : "";
      const model = vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || "";
      const text = [task.taskNumber, task.requester, task.origin, task.transferLocation, task.destination, task.vehicle, model, task.status, task.result, task.error].join(" ").toLowerCase();
      return (!keyword || text.includes(keyword)) && (!vehicle || task.vehicle === vehicle) && (!requester || task.requester === requester) && (!status || task.status === status) && (!dateFrom || (dateText && dateText >= dateFrom)) && (!dateTo || (dateText && dateText <= dateTo));
    }).sort((left, right) => new Date(right.departureTime || 0).getTime() - new Date(left.departureTime || 0).getTime());
  }

  function renderHistorySelect(select, placeholder, entries) {
    if (!select) return;
    const queryKeys = { historyVehicleFilter: "historyVehicle", historyRequesterFilter: "historyRequester", historyStatusFilter: "historyStatus" };
    const current = select.value || params.get(queryKeys[select.id] || "") || "";
    select.innerHTML = `<option value="">${t(placeholder)}</option>` + entries.map((entry) => `<option value="${escapeHtml(entry)}">${escapeHtml(t(entry))}</option>`).join("");
    if (entries.includes(current)) select.value = current;
  }

  function renderHistory() {
    if (!historyRows) return;
    const vehicles = [...new Set(state.tasks.map((task) => task.vehicle).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const requesters = [...new Set(state.tasks.map((task) => task.requester).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const statusOrder = ["已预约", "待调度", "已排程", "执行中", "已完成", "失败", "取消"];
    const statuses = [...new Set([...statusOrder, ...state.tasks.map((task) => task.status).filter(Boolean)])];
    renderHistorySelect(historyVehicleFilter, "全部车辆", vehicles);
    renderHistorySelect(historyRequesterFilter, "全部驾驶人", requesters);
    renderHistorySelect(historyStatusFilter, "全部状态", statuses);
    const tasks = historyTasks();
    $("historySummary").textContent = `${tasks.length} ${t("条匹配记录")}`;
    $("historySummary").className = "notice inline-notice success";
    if (!tasks.length) { historyRows.innerHTML = `<tr><td colspan="8" class="empty">${t("没有匹配的调度任务。")}</td></tr>`; return; }
    historyRows.innerHTML = tasks.map((task) => {
      const model = vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || t("车型未配置");
      const mileage = task.returnMileage !== null ? `${t("出发")} ${formatMileage(task.mileage)} · ${t("返程")} ${formatMileage(task.returnMileage)}` : `${t("出发")} ${formatMileage(task.mileage)}`;
      const deleteAction = userCan("delete_dispatch") ? `<button class="action-link danger-link" data-delete-id="${escapeHtml(task.recordId)}">${t("删除")}</button>` : "";
      return `<tr><td><strong>${escapeHtml(task.taskNumber || t("未编号"))}</strong></td><td>${escapeHtml(task.requester || t("未填写"))}</td><td>${escapeHtml(formatDate(task.departureTime))}</td><td class="route"><span>${escapeHtml(taskRoute(task) || "—")}</span>${task.returnOrigin || task.returnDestination ? `<small class="history-return-route">${escapeHtml(taskRoute(task, "return") || "—")}</small>` : ""}</td><td><span class="vehicle">${escapeHtml(task.vehicle || t("未分配"))}</span><span class="driver">${escapeHtml(model)}</span></td><td><span class="badge ${statusClass(task.status)}">${escapeHtml(t(task.status || "未设置"))}</span></td><td class="mileage">${escapeHtml(mileage)}</td><td class="row-actions"><button class="action-link" data-history-record="${escapeHtml(task.recordId)}">${t("查看")}</button>${deleteAction}</td></tr>`;
    }).join("");
  }

  function renderReturnPicker() {
    const container = $("returnTaskList");
    const tasks = state.tasks.filter((task) => userCan("submit_return") && isOwnTask(task) && isDepartedTask(task) && task.status !== "已完成" && task.status !== "取消" && task.returnMileage === null && task.stage !== "已返程");
    if (!tasks.length) { container.innerHTML = `<div class="empty-card">${t("暂无可办理返程的调度任务。")}</div>`; return; }
    container.innerHTML = tasks.map((task) => `<button class="return-task-card" data-return-id="${escapeHtml(task.recordId)}"><span class="return-task-plate">${escapeHtml(task.vehicle || t("未分配车辆"))}</span><span>${escapeHtml(vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || t("车型未配置"))}</span><small>${task.tripMode === "中转" ? `${escapeHtml(t("中转"))} · ` : ""}${escapeHtml(taskRoute(task) || "—")} · ${t("出发")} ${escapeHtml(formatDate(task.departureTime))}</small><i>${t("填写返程 ›")}</i></button>`).join("");
  }

  function renderTransferPicker() {
    const container = $("transferTaskList");
    if (!container) return;
    const tasks = state.tasks.filter((task) => userCan("submit_transfer") && isOwnTask(task) && isDepartedTask(task) && task.status !== "已完成" && task.status !== "取消" && task.returnMileage === null && task.stage !== "已返程");
    if (!tasks.length) { container.innerHTML = `<div class="empty-card">${t("暂无可办理中转的调度任务。")}</div>`; return; }
    container.innerHTML = tasks.map((task) => `<button class="return-task-card" data-transfer-id="${escapeHtml(task.recordId)}"><span class="return-task-plate">${escapeHtml(task.vehicle || t("未分配车辆"))}</span><span>${escapeHtml(vehicleByPlate(task.vehicle)?.modelDescription || task.vehicleModel || t("车型未配置"))}</span><small>${escapeHtml(taskRoute(task) || "—")} · ${t("出发")} ${escapeHtml(formatDate(task.departureTime))}${task.transferLocation ? ` · ${escapeHtml(t("已中转"))}：${escapeHtml(task.transferLocation)}` : ""}</small><i>${task.transferLocation ? t("修改中转 ›") : t("登记中转 ›")}</i></button>`).join("");
  }

  function vehicleMissingFields(vehicle) {
    const missing = [];
    if (!vehicle.brand) missing.push("品牌");
    if (!vehicle.model) missing.push("车型");
    if (!vehicle.vehicleType) missing.push("车辆类型");
    if (!vehicle.status) missing.push("车辆状态");
    if (!vehicle.owner) missing.push("所属部门/门店");
    if (!vehicle.year) missing.push("年份");
    if (!vehicle.currentMileageField) missing.push("当前公里数字段");
    else if (vehicle.mileage === null) missing.push("当前公里数");
    if (!vehicle.nextMaintenanceMileageField) missing.push("保养里程字段");
    else if (vehicle.nextMaintenanceMileage === null) missing.push("下次保养里程");
    if (!vehicle.nextMaintenanceDateField) missing.push("保养日期字段");
    else if (!vehicle.nextMaintenanceDate) missing.push("下次保养日期");
    if (!vehicle.photoUrl) missing.push("车辆照片");
    [[vehicle.registeringAuthorityField, vehicle.registeringAuthority, "注册地点"], [vehicle.lastServiceDateField, vehicle.lastServiceDate, "上次保养日期"], [vehicle.serviceProviderField, vehicle.serviceProvider, "服务提供商"], [vehicle.spareKeyField, vehicle.spareKey, "备用钥匙"], [vehicle.registerNumberField, vehicle.registerNumber, "注册号"], [vehicle.vehicleIdentificationNumberField, vehicle.vehicleIdentificationNumber, "车辆 ID / VIN"], [vehicle.certificateExpiryField, vehicle.certificateExpiry, "年检到期日期"], [vehicle.logBookField, vehicle.logBookAttachments?.length, "车辆大本"], [vehicle.policyNumberField, vehicle.policyNumber, "保单号"], [vehicle.insuranceField, vehicle.insurance, "保险信息"]].forEach(([field, value, label]) => {
      if (field && !value) missing.push(label);
    });
    return missing;
  }

  const REMINDER_WINDOW_DAYS = 30;

  function dateOnly(value) {
    const text = String(value || "").trim();
    const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    if (matched) {
      const year = Number(matched[1]); const month = Number(matched[2]); const day = Number(matched[3]);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
    }
    const parsed = new Date(text);
    if (!Number.isFinite(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function reminderDateStatus(value) {
    if (!value) return { kind: "missing", days: null };
    const date = dateOnly(value);
    if (!date) return { kind: "invalid", days: null };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return { kind: "overdue", days };
    if (days <= REMINDER_WINDOW_DAYS) return { kind: "dueSoon", days };
    return { kind: "normal", days };
  }

  function reminderText(category, status) {
    const englishCategory = category === "年检" ? "Inspection" : "Maintenance";
    if (status.kind === "overdue") return state.language === "en" ? `${englishCategory} overdue` : `${category}已逾期`;
    if (status.kind === "dueSoon") return state.language === "en" ? `${englishCategory} due in ${status.days} days` : `${category}${status.days}天内到期`;
    if (status.kind === "invalid") return state.language === "en" ? `${englishCategory} date invalid` : `${category}日期无效`;
    if (status.kind === "missing") return state.language === "en" ? `${englishCategory} date not entered` : `${category}日期待填写`;
    return state.language === "en" ? `${englishCategory} normal` : `${category}正常`;
  }

  function inspectionReminder(vehicle) {
    const status = vehicle.certificateExpiryField ? reminderDateStatus(vehicle.certificateExpiry) : { kind: "missing", days: null };
    return { ...status, text: vehicle.certificateExpiryField ? reminderText("年检", status) : t("本表未设置") };
  }

  function maintenanceReminder(vehicle) {
    const mileageDue = vehicle.mileage !== null && vehicle.nextMaintenanceMileage !== null && vehicle.mileage >= vehicle.nextMaintenanceMileage;
    const dateStatus = vehicle.nextMaintenanceDateField ? reminderDateStatus(vehicle.nextMaintenanceDate) : { kind: "missing", days: null };
    if (mileageDue) return { kind: "overdue", text: state.language === "en" ? "Maintenance mileage reached" : "保养里程已到" };
    if (dateStatus.kind !== "normal") return { ...dateStatus, text: vehicle.nextMaintenanceDateField ? reminderText("保养", dateStatus) : t("本表未设置") };
    if (vehicle.nextMaintenanceMileage === null && !vehicle.nextMaintenanceDate) return { kind: "missing", text: state.language === "en" ? "Maintenance plan not entered" : "保养计划待填写" };
    return { kind: "normal", text: reminderText("保养", dateStatus) };
  }

  function reminderBadge(reminder) {
    const tone = reminder.kind === "overdue" ? "maintenance-critical" : reminder.kind === "dueSoon" || reminder.kind === "missing" || reminder.kind === "invalid" ? "maintenance-warn" : "maintenance-ok";
    return `<span class="maintenance ${tone}">${escapeHtml(reminder.text)}</span>`;
  }

  const vehicleDepartmentOptions = [
    ["administration", "行政部"], ["maintenance", "维护部"], ["operations", "运营部"],
    ["procurement", "采购部"], ["warehouse", "仓库部"], ["store", "门店部"], ["tophida", "Tophida"], ["sold", "已售车辆"]
  ];
  const vehicleDispatchDepartmentOptions = [["", "全部"], ...vehicleDepartmentOptions.filter(([value]) => value !== "sold")];

  function vehicleDepartment(vehicle) {
    const owner = `${cleanDisplay(vehicle.owner)} ${cleanDisplay(vehicle.tableName)}`.toLowerCase();
    if (/administration|行政/.test(owner)) return "administration";
    if (/maintenance|维护/.test(owner)) return "maintenance";
    if (/operations|运营/.test(owner)) return "operations";
    if (/procurement|采购/.test(owner)) return "procurement";
    if (/warehouse|仓库/.test(owner)) return "warehouse";
    if (/store|门店/.test(owner)) return "store";
    if (/tophida/.test(owner)) return "tophida";
    return "";
  }

  function isSoldVehicle(vehicle) {
    const searchable = cleanDisplay([vehicle.status, vehicle.plate, vehicle.model, vehicle.modelDescription].filter(Boolean).join(" ")).toLowerCase();
    return /sold|已售/.test(searchable);
  }

  function renderVehicleDepartmentFilter() {
    if (!vehicleDepartmentFilter) return;
    const current = vehicleDepartmentFilter.value;
    vehicleDepartmentFilter.innerHTML = `<option value="">${t("全部")}</option>` + vehicleDepartmentOptions.map(([value, label]) => `<option value="${value}">${t(label)}</option>`).join("");
    if (["", ...vehicleDepartmentOptions.map(([value]) => value)].includes(current)) vehicleDepartmentFilter.value = current;
  }

  function renderVehicleDepartmentQuickSelect(select) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = vehicleDispatchDepartmentOptions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(t(label))}</option>`).join("");
    if (vehicleDispatchDepartmentOptions.some(([value]) => value === current)) select.value = current;
  }

  function dispatchVehiclesFor(select) {
    const filter = select?.value || "";
    const eligible = state.vehicles.filter((item) => item.dispatchEligible && !isSoldVehicle(item));
    if (!filter) return eligible;
    const filtered = eligible.filter((item) => vehicleDepartment(item) === filter);
    // A user's department label may differ from the Base owner label. Do not
    // leave the dispatch selector empty when the account can already see the
    // vehicles but the optional category has no exact match.
    return filtered.length ? filtered : eligible;
  }

  function trackerVehicleKey(vehicle) {
    return `${vehicle.tableId}:${vehicle.recordId}`;
  }

  function trackerMatchForVehicle(vehicle) {
    const key = trackerVehicleKey(vehicle);
    return state.trackerStatus?.matches?.find((match) => match.vehicleKey === key) || null;
  }

  function trackerFreshness(match) {
    if (match?.status === "pending_confirmation") return { kind: "pending", label: t("待确认") };
    if (match?.status !== "matched" || !match.snapshot?.trackerTimestamp) return { kind: "missing", label: t("Tracker 未匹配") };
    const timestamp = Date.parse(match.snapshot.trackerTimestamp);
    const age = Date.now() - timestamp;
    if (!Number.isFinite(age)) return { kind: "check", label: t("超过24小时未更新 · 需要关注") };
    const hours = Math.max(0, Math.floor(Math.max(0, age) / (60 * 60 * 1000)));
    if (hours >= 24) return { kind: "check", label: t("超过24小时未更新 · 需要关注") };
    if (hours >= 1) return { kind: "stale", label: state.language === "en" ? `${hours} hour${hours === 1 ? "" : "s"} without update` : `${hours}小时未更新` };
    return { kind: "current", label: t("更新不足1小时") };
  }

  function trackerTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? t("未填写") : new Intl.DateTimeFormat(state.language === "en" ? "en-ZA" : "zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Johannesburg" }).format(date);
  }

  function trackerLocationMarkup(location) {
    const address = String(location || "").trim();
    if (!address) return `<strong>${escapeHtml(t("未填写"))}</strong>`;
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const mapLabel = `${t("在地图中查看")}：${address}`;
    return `<button type="button" class="tracker-location-link" data-tracker-map-url="${escapeHtml(mapUrl)}" title="${escapeHtml(t("在地图中查看"))}" aria-label="${escapeHtml(mapLabel)}"><strong>${escapeHtml(address)}</strong><span aria-hidden="true">&#8599;</span></button>`;
  }

  function trackerBadge(match) {
    const freshness = trackerFreshness(match);
    const actualState = match?.status === "matched" && match.snapshot
      ? String(match.snapshot.status || "").trim() || t("未填写")
      : "";
    const actualSuffix = actualState ? ` <span class="tracker-actual-inline">(${escapeHtml(actualState)})</span>` : "";
    return `<span class="tracker-status tracker-${freshness.kind}" title="${escapeHtml(t("Tracker 更新状态"))}: ${escapeHtml(freshness.label)}${actualState ? ` (${escapeHtml(actualState)})` : ""}">${escapeHtml(freshness.label)}${actualSuffix}</span>`;
  }

  function trackerActualStateBadge(match, showUnavailable = false) {
    if ((match?.status !== "matched" || !match.snapshot) && !showUnavailable) return "";
    const actualState = match?.status === "matched" && match.snapshot
      ? String(match.snapshot.status || "").trim() || t("未填写")
      : t("未获取");
    const label = t("车辆实际状态");
    return `<span class="tracker-actual-state" title="${escapeHtml(label)}: ${escapeHtml(actualState)}">${escapeHtml(label)} · ${escapeHtml(actualState)}</span>`;
  }

  function trackerMatchMessage(match) {
    if (match?.reason === "vin_conflict") return t("车辆档案 VIN 与 Tracker VIN 不一致，需要管理员确认。");
    if (match?.status === "pending_confirmation") return t("发现重复 Tracker 记录，需要管理员核对 VIN 和车牌后确认。");
    return t("Tracker 中暂未找到这辆车。");
  }

  function renderVehicleTrackerLiveStatus(vehicle = state.editingVehicle) {
    const select = $("vehicleTrackerInput");
    if (!select) return;
    let panel = $("vehicleTrackerLiveStatus");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "vehicleTrackerLiveStatus";
      panel.className = "vehicle-tracker-editor-status";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      select.parentElement?.append(panel);
    }
    const match = vehicle ? trackerMatchForVehicle(vehicle) : null;
    const snapshot = match?.status === "matched" ? match.snapshot : null;
    if (!snapshot) {
      panel.innerHTML = state.trackerStatus?.lastSuccessAt
        ? `<span class="tracker-status tracker-missing">${escapeHtml(t("Tracker 未匹配"))}</span><small>${escapeHtml(trackerMatchMessage(match))}</small>`
        : `<small>${escapeHtml(t("Tracker 数据尚未加载"))}</small>`;
      return;
    }
    panel.innerHTML = `<div class="vehicle-tracker-editor-heading"><strong>${escapeHtml(snapshot.registration)}</strong>${trackerBadge(match)}</div><div class="vehicle-tracker-editor-grid"><span><small>${escapeHtml(t("车辆实际状态"))}</small><strong>${escapeHtml(snapshot.status || t("未填写"))}</strong></span><span><small>${escapeHtml(t("Tracker 位置"))}</small><strong>${escapeHtml(snapshot.location || t("未填写"))}</strong></span><span><small>${escapeHtml(t("数据时间"))}</small><strong>${escapeHtml(trackerTime(snapshot.trackerTimestamp))}</strong></span><span><small>${escapeHtml(t("最后同步"))}</small><strong>${escapeHtml(trackerTime(state.trackerStatus?.lastSuccessAt))}</strong></span></div>`;
  }

  function renderTrackerDialog() {
    const vehicle = state.vehicles.find((item) => trackerVehicleKey(item) === state.trackerVehicleKey);
    if (!vehicle || !trackerDialogBody) return;
    const match = trackerMatchForVehicle(vehicle);
    const snapshot = match?.status === "matched" ? match.snapshot : null;
    trackerDialogTitle.textContent = t("车辆位置状态");
    trackerDialogSubtitle.textContent = `${vehicle.plate || t("未填写车牌")} · ${vehicle.modelDescription || t("车型未配置")}`;
    const syncWarning = state.trackerStatus?.syncFailed
      ? `<div class="tracker-dialog-alert tracker-dialog-alert-warning">${escapeHtml(t("最近同步失败，正在显示上一次成功数据。"))}</div>`
      : "";
    const locationMarkup = snapshot ? trackerLocationMarkup(snapshot.location) : "";
    trackerDialogBody.innerHTML = snapshot
      ? `${syncWarning}<div class="tracker-dialog-status-row"><span>${t("Tracker 更新状态")}</span>${trackerBadge(match)}</div><div class="tracker-detail-grid"><span><small>${t("Tracker 位置")}</small>${locationMarkup}</span><span><small>${t("车辆实际状态")}</small><strong>${escapeHtml(snapshot.status || t("未填写"))}</strong></span><span><small>${t("Tracker 里程")}</small><strong>${escapeHtml(formatMileage(snapshot.odometer))}</strong></span><span><small>${t("数据时间")}</small><strong>${escapeHtml(trackerTime(snapshot.trackerTimestamp))}</strong></span><span><small>${t("最后同步")}</small><strong>${escapeHtml(trackerTime(state.trackerStatus?.lastSuccessAt))}</strong></span></div>`
      : `<div class="tracker-dialog-empty"><div class="tracker-dialog-status-row"><span>${t("Tracker 更新状态")}</span>${trackerBadge(match)}</div><p>${escapeHtml(trackerMatchMessage(match))}</p>${state.trackerStatus?.syncFailed ? syncWarning : ""}</div>`;
    if (trackerRefreshButton) {
      const pending = Boolean(state.trackerStatus?.refresh?.pending);
      trackerRefreshButton.hidden = !userCan("refresh_tracker");
      trackerRefreshButton.disabled = pending;
      trackerRefreshButton.setAttribute("aria-busy", String(pending));
      trackerRefreshButton.textContent = t(pending ? "刷新已排队" : "立即刷新");
    }
  }

  function openTrackerVehicle(tableId, recordId, updateUrl = true) {
    const vehicle = state.vehicles.find((item) => item.tableId === tableId && item.recordId === recordId);
    if (!vehicle || !trackerVehicleDialog) return;
    state.trackerVehicleKey = trackerVehicleKey(vehicle);
    setInlineStatus(trackerDialogNotice, "");
    renderTrackerDialog();
    if (!trackerVehicleDialog.open) trackerVehicleDialog.showModal();
    if (updateUrl) updateQueryState({ tracker: state.trackerVehicleKey });
  }

  async function requestTrackerRefresh() {
    if (!trackerRefreshButton || trackerRefreshButton.disabled) return;
    trackerRefreshButton.disabled = true;
    trackerRefreshButton.setAttribute("aria-busy", "true");
    trackerRefreshButton.textContent = t("正在提交刷新请求…");
    setInlineStatus(trackerDialogNotice, "");
    try {
      const response = await fetch("/api/tracker/refresh", { method: "POST", headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (state.trackerStatus) state.trackerStatus.refresh = payload.refresh;
      setInlineStatus(trackerDialogNotice, payload.message || "Tracker 刷新已排队；系统会在安全间隔到期后执行。", "success");
      renderTrackerDialog();
    } catch (error) {
      setInlineStatus(trackerDialogNotice, `刷新请求失败：${error.message}`, "error");
      trackerRefreshButton.disabled = false;
      trackerRefreshButton.setAttribute("aria-busy", "false");
      trackerRefreshButton.textContent = t("立即刷新");
    }
  }

  function localDateTimeValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function setTrackerHistoryRange(hours) {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
    trackerHistoryFrom.value = localDateTimeValue(from);
    trackerHistoryTo.value = localDateTimeValue(to);
  }

  function renderTrackerHistoryVehicleOptions() {
    if (!trackerHistoryVehicle) return;
    const current = trackerHistoryVehicle.value || params.get("trackerVehicle") || "";
    const options = [...state.vehicles]
      .sort((left, right) => `${left.owner || ""} ${left.plate || ""}`.localeCompare(`${right.owner || ""} ${right.plate || ""}`))
      .map((vehicle) => `<option value="${escapeHtml(trackerVehicleKey(vehicle))}">${escapeHtml(vehicle.plate || t("未填写车牌"))} · ${escapeHtml(vehicle.modelDescription || t("车型未配置"))}${vehicle.owner ? ` · ${escapeHtml(vehicle.owner)}` : ""}</option>`)
      .join("");
    trackerHistoryVehicle.innerHTML = `<option value="">${t("全部可访问车辆")}</option>${options}`;
    if ([...trackerHistoryVehicle.options].some((option) => option.value === current)) trackerHistoryVehicle.value = current;
  }

  function trackerHistoryUrl() {
    const query = new URLSearchParams({ view: "tracker-history" });
    if (trackerHistoryVehicle.value) query.set("trackerVehicle", trackerHistoryVehicle.value);
    if (trackerHistoryFrom.value) query.set("trackerFrom", new Date(trackerHistoryFrom.value).toISOString());
    if (trackerHistoryTo.value) query.set("trackerTo", new Date(trackerHistoryTo.value).toISOString());
    if (trackerHistoryQuery.value.trim()) query.set("trackerQuery", trackerHistoryQuery.value.trim());
    if (trackerHistoryStatus.value.trim()) query.set("trackerStatus", trackerHistoryStatus.value.trim());
    if (trackerHistoryOrder.value !== "desc") query.set("trackerOrder", trackerHistoryOrder.value);
    if (trackerHistoryLimit.value !== "100") query.set("trackerLimit", trackerHistoryLimit.value);
    return `?${query.toString()}`;
  }

  function restoreTrackerHistoryFilters() {
    if (!trackerHistoryForm) return;
    const from = params.get("trackerFrom");
    const to = params.get("trackerTo");
    if (from) trackerHistoryFrom.value = localDateTimeValue(from);
    if (to) trackerHistoryTo.value = localDateTimeValue(to);
    if (!trackerHistoryFrom.value || !trackerHistoryTo.value) setTrackerHistoryRange(24);
    trackerHistoryQuery.value = params.get("trackerQuery") || "";
    trackerHistoryStatus.value = params.get("trackerStatus") || "";
    trackerHistoryOrder.value = params.get("trackerOrder") === "asc" ? "asc" : "desc";
    trackerHistoryLimit.value = ["50", "100", "250", "500"].includes(params.get("trackerLimit")) ? params.get("trackerLimit") : "100";
  }

  function renderTrackerHistoryRows() {
    if (!trackerHistoryRows) return;
    if (!state.trackerHistoryEntries.length) {
      trackerHistoryRows.innerHTML = `<tr><td colspan="6" class="empty">${t("暂无查询结果。")}</td></tr>`;
    } else {
      trackerHistoryRows.innerHTML = state.trackerHistoryEntries.map((entry) => {
        const vehicleLabel = entry.vehicle?.plate || entry.registration || t("未填写车牌");
        const vehicleMeta = entry.vehicle?.modelDescription || entry.alias || "";
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entry.location || "")}`;
        return `<tr><td><strong>${escapeHtml(trackerTime(entry.trackerTimestamp))}</strong></td><td><strong>${escapeHtml(vehicleLabel)}</strong>${vehicleMeta ? `<small class="tracker-history-meta">${escapeHtml(vehicleMeta)}</small>` : ""}</td><td><span class="tracker-actual-state">${escapeHtml(entry.status || t("未填写"))}</span></td><td><button type="button" class="tracker-history-location" data-history-map-url="${escapeHtml(mapUrl)}">${escapeHtml(entry.location || t("未填写"))}<span aria-hidden="true">&#8599;</span></button></td><td>${escapeHtml(formatMileage(entry.odometer))}</td><td>${escapeHtml(trackerTime(entry.recordedAt))}</td></tr>`;
      }).join("");
    }
    const canRoute = state.trackerHistoryRouteLocations.length >= 2;
    trackerHistoryRouteButton.disabled = !canRoute;
    trackerHistoryLoadMore.hidden = !state.trackerHistoryHasMore;
    trackerHistoryRouteSummary.hidden = state.trackerHistoryRoutePointCount < 1;
    const routePointCount = state.trackerHistoryRoutePointCount;
    const sampledPointCount = state.trackerHistoryRouteLocations.length;
    trackerHistoryRouteSummary.textContent = routePointCount
      ? (state.language === "en"
        ? `${routePointCount} location change${routePointCount === 1 ? "" : "s"} found. The map route uses up to ${sampledPointCount} sampled point${sampledPointCount === 1 ? "" : "s"} and is approximate.`
        : `已识别 ${state.trackerHistoryRoutePointCount} 个位置变化节点；地图路线使用最多 ${state.trackerHistoryRouteLocations.length} 个采样点，结果仅供回溯参考。`)
      : "";
    if (state.trackerHistoryLoaded) {
      const recordCount = state.trackerHistoryEntries.length;
      const summary = state.language === "en"
        ? `Showing ${recordCount} record${recordCount === 1 ? "" : "s"}${state.trackerHistoryHasMore ? "; more available" : ""}. History is retained for up to ${state.trackerHistoryRetentionDays} days.`
        : `已显示 ${state.trackerHistoryEntries.length} 条记录${state.trackerHistoryHasMore ? "，可继续加载" : ""}。历史记录最多保留 ${state.trackerHistoryRetentionDays} 天。`;
      setInlineStatus(trackerHistorySummary, summary, "success");
    }
  }

  async function loadTrackerHistory(reset = true) {
    if (!trackerHistoryForm) return;
    const from = new Date(trackerHistoryFrom.value);
    const to = new Date(trackerHistoryTo.value);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      setInlineStatus(trackerHistorySummary, t("查询起止时间无效。"), "error");
      return;
    }
    if (reset) {
      state.trackerHistoryLoaded = false;
      state.trackerHistoryEntries = [];
      state.trackerHistoryNextOffset = 0;
      state.trackerHistoryRouteLocations = [];
      state.trackerHistoryRoutePointCount = 0;
      renderTrackerHistoryRows();
    }
    setInlineStatus(trackerHistorySummary, t("正在查询 Tracker 历史记录…"));
    history.replaceState(null, "", trackerHistoryUrl());
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      order: trackerHistoryOrder.value,
      limit: trackerHistoryLimit.value,
      offset: String(reset ? 0 : state.trackerHistoryNextOffset)
    });
    if (trackerHistoryVehicle.value) query.set("vehicleKey", trackerHistoryVehicle.value);
    if (trackerHistoryQuery.value.trim()) query.set("q", trackerHistoryQuery.value.trim());
    if (trackerHistoryStatus.value.trim()) query.set("status", trackerHistoryStatus.value.trim());
    try {
      const response = await fetch(`/api/tracker/history?${query.toString()}`, { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.trackerHistoryEntries = reset ? (payload.entries || []) : [...state.trackerHistoryEntries, ...(payload.entries || [])];
      state.trackerHistoryHasMore = Boolean(payload.hasMore);
      state.trackerHistoryNextOffset = payload.nextOffset || state.trackerHistoryEntries.length;
      state.trackerHistoryRouteLocations = payload.routeLocations || [];
      state.trackerHistoryRoutePointCount = payload.routePointCount || 0;
      state.trackerHistoryRetentionDays = payload.retentionDays || 90;
      state.trackerHistoryLoaded = true;
      renderTrackerHistoryRows();
    } catch (error) {
      state.trackerHistoryLoaded = false;
      state.trackerHistoryHasMore = false;
      renderTrackerHistoryRows();
      setInlineStatus(trackerHistorySummary, `${t("Tracker 历史查询失败：")}${error.message}`, "error");
    }
  }

  function openTrackerHistory(vehicleKey = "", updateUrl = true, load = true) {
    if (!trackerHistoryForm) return;
    const selectedVehicleKey = vehicleKey || params.get("trackerVehicle") || trackerHistoryVehicle.value || "";
    if (trackerVehicleDialog?.open) trackerVehicleDialog.close();
    document.body.classList.remove("editor-mode");
    showOnly("trackerHistory");
    renderTrackerHistoryVehicleOptions();
    if (selectedVehicleKey && [...trackerHistoryVehicle.options].some((option) => option.value === selectedVehicleKey)) trackerHistoryVehicle.value = selectedVehicleKey;
    if (!trackerHistoryFrom.value || !trackerHistoryTo.value) setTrackerHistoryRange(24);
    if (updateUrl) history.replaceState(null, "", trackerHistoryUrl());
    if (load) void loadTrackerHistory(true);
  }

  function openTrackerHistoryRoute() {
    const points = state.trackerHistoryRouteLocations;
    if (points.length < 2) return;
    const routeUrl = new URL("https://www.google.com/maps/dir/");
    routeUrl.searchParams.set("api", "1");
    routeUrl.searchParams.set("origin", points[0]);
    routeUrl.searchParams.set("destination", points.at(-1));
    routeUrl.searchParams.set("travelmode", "driving");
    if (points.length > 2) routeUrl.searchParams.set("waypoints", points.slice(1, -1).join("|"));
    window.location.assign(routeUrl.toString());
  }

  function vehicleCardMarkup(vehicle) {
      const maintenance = maintenanceReminder(vehicle);
      const inspection = inspectionReminder(vehicle);
      const missing = vehicleMissingFields(vehicle);
      const photo = vehicle.photoUrl ? `<img src="${escapeHtml(vehicle.photoUrl)}" alt="${escapeHtml(vehicle.plate)} ${t("车辆照片")}" width="640" height="360" loading="lazy" decoding="async" />` : `<div class="vehicle-placeholder"><span>${state.language === "en" ? "🚙" : "车"}</span><small>${t("暂无车辆照片")}</small></div>`;
      const department = cleanDisplay(vehicle.owner) || t("未设置部门/门店");
      const year = cleanDisplay(vehicle.year) || t("年份未填写");
      const mileage = vehicle.mileage === null ? t("未填写") : formatMileage(vehicle.mileage);
      const nextMaintenance = vehicle.nextMaintenanceMileage === null ? t("未填写") : formatMileage(vehicle.nextMaintenanceMileage);
      const nextMaintenanceDate = vehicle.nextMaintenanceDate || t("未填写");
      const inspectionExpiry = vehicle.certificateExpiry || t("未填写");
      const trackerMatch = state.trackerStatus ? trackerMatchForVehicle(vehicle) : null;
      const completeness = missing.length ? `<p class="vehicle-completeness incomplete">${t("待补全")} ${missing.length} ${state.language === "en" ? "fields: " : "项："}${escapeHtml(missing.map(t).join(state.language === "en" ? ", " : "、"))}</p>` : `<p class="vehicle-completeness complete">${t("车辆资料完整")}</p>`;
      const managementAction = userCan("manage_vehicles") ? `<button class="vehicle-edit" data-vehicle-table="${escapeHtml(vehicle.tableId)}" data-vehicle-record="${escapeHtml(vehicle.recordId)}">${t("管理车辆")}</button>` : "";
      return `<article class="vehicle-card"><div class="vehicle-image">${photo}</div><div class="vehicle-card-body"><div class="vehicle-kicker">${escapeHtml(department)}</div><div class="vehicle-model">${escapeHtml(vehicle.modelDescription || t("车型未配置"))}</div><div class="vehicle-plate">${escapeHtml(vehicle.plate || t("未填写车牌"))}</div><div class="vehicle-specs"><span><small>${t("年份")}</small><strong>${escapeHtml(year)}</strong></span><span><small>${t("当前公里数")}</small><strong>${escapeHtml(mileage)}</strong></span></div><div class="vehicle-maintenance-row"><span>${t("下次保养")}</span><strong>${escapeHtml(nextMaintenance)}</strong></div><div class="vehicle-maintenance-row"><span>${t("下次保养日期")}</span><strong>${escapeHtml(nextMaintenanceDate)}</strong></div><div class="vehicle-maintenance-row"><span>${t("年检到期日期")}</span><strong>${escapeHtml(inspectionExpiry)}</strong></div>${completeness}<div class="vehicle-card-status">${state.trackerStatus ? trackerBadge(trackerMatch) : ""}${reminderBadge(maintenance)}${reminderBadge(inspection)}</div><div class="vehicle-actions"><button class="vehicle-dispatch" data-new-plate="${escapeHtml(vehicle.plate)}" ${vehicle.dispatchEligible ? "" : "disabled"}>${t(vehicle.dispatchEligible ? "用此车新建调度" : "不可新建调度")}</button>${managementAction}<button class="vehicle-locate" type="button" data-tracker-table="${escapeHtml(vehicle.tableId)}" data-tracker-record="${escapeHtml(vehicle.recordId)}">${t("车辆位置状态")}</button></div></div></article>`;
  }

  function renderVehicleCards(container, vehicles, emptyMessage) {
    if (!container) return;
    container.innerHTML = vehicles.length ? vehicles.map(vehicleCardMarkup).join("") : `<div class="empty-card">${emptyMessage}</div>`;
  }

  function renderVehicles() {
    const container = $("vehicleCards");
    const soldContainer = $("soldVehicleCards");
    if (!container) return;
    if (!state.vehicles.length) { $("vehicleDataCount").textContent = t("没有读取到车辆档案。"); container.innerHTML = `<div class="empty-card">${t("没有读取到车辆档案。")}</div>`; if (soldContainer) soldContainer.innerHTML = ""; return; }
    const filter = vehicleDepartmentFilter?.value || "";
    const filteredVehicles = state.vehicles.filter((vehicle) => {
      if (!filter) return true;
      if (filter === "sold") return isSoldVehicle(vehicle);
      return vehicleDepartment(vehicle) === filter;
    });
    const soldVehicles = filteredVehicles.filter(isSoldVehicle);
    const activeVehicles = filteredVehicles.filter((vehicle) => !isSoldVehicle(vehicle));
    const showingSold = filter === "sold";
    $("vehicleDataCount").textContent = `${showingSold ? soldVehicles.length : activeVehicles.length} / ${state.vehicles.length}`;
    renderVehicleCards(container, showingSold ? soldVehicles : activeVehicles, t(showingSold ? "没有已售车辆。" : "这个部门 / 门店暂无匹配车辆。"));
    if (soldContainer) {
      renderVehicleCards(soldContainer, soldVehicles, t("没有已售车辆。"));
      $("soldVehicleCount").textContent = String(soldVehicles.length);
      $("soldVehiclesPanel").hidden = showingSold;
    }
  }

  function populateSelect(select, items, placeholder, labeler) {
    const current = select.value;
    const grouped = new Map();
    items.forEach((item) => {
      const department = String(item.department || "").trim() || t("未分配部门");
      if (!grouped.has(department)) grouped.set(department, []);
      grouped.get(department).push(item);
    });
    const options = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([department, departmentItems]) => `<optgroup label="${escapeHtml(department)}">${departmentItems.sort((a, b) => labeler(a).localeCompare(labeler(b))).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(labeler(item))}</option>`).join("")}</optgroup>`).join("");
    select.innerHTML = `<option value="">${placeholder}</option>` + options;
    if (items.some((item) => item.id === current)) select.value = current;
  }

  function populateStoreQuickChoices(input, select) {
    if (!input || !select) return;
    const current = input.value;
    const options = state.stores.map((store) => `<option value="${escapeHtml(store.name)}">${escapeHtml(store.name)}</option>`).join("");
    select.innerHTML = `<option value="">${t("快速选择门店")}</option>` + options;
    if (state.stores.some((store) => store.name === current)) select.value = current;
  }

  function renderOptions() {
    const driverPlaceholder = state.users.length ? t("请选择驾驶人") : t("正在读取驾驶人…");
    populateSelect($("requesterSelect"), state.users, driverPlaceholder, userLabel);
    populateSelect($("bookingRequesterSelect"), state.users, driverPlaceholder, userLabel);
    setDefaultRequester("requesterSelect", "requesterInput", "requesterMatchStatus");
    setDefaultRequester("bookingRequesterSelect", "bookingRequesterInput", "bookingRequesterMatchStatus");
    renderRequesterSuggestions("requesterInput", "requesterSuggestions");
    renderRequesterSuggestions("bookingRequesterInput", "bookingRequesterSuggestions");
    syncRequesterInput("requesterSelect", "requesterInput");
    syncRequesterInput("bookingRequesterSelect", "bookingRequesterInput");
    updateRequesterMatchStatus("requesterInput", "requesterSelect", "requesterMatchStatus");
    updateRequesterMatchStatus("bookingRequesterInput", "bookingRequesterSelect", "bookingRequesterMatchStatus");
    populateStoreQuickChoices($("originInput"), $("originQuickSelect"));
    populateStoreQuickChoices($("destinationInput"), $("destinationQuickSelect"));
    populateStoreQuickChoices($("bookingOriginInput"), $("bookingOriginQuickSelect"));
    populateStoreQuickChoices($("bookingDestinationInput"), $("bookingDestinationQuickSelect"));
    populateStoreQuickChoices($("transferLocationInput"), $("transferLocationQuickSelect"));
    populateStoreQuickChoices(returnOriginInput, returnOriginQuickSelect);
    populateStoreQuickChoices(returnDestinationInput, returnDestinationQuickSelect);
    renderVehicleDepartmentQuickSelect(vehicleDepartmentQuickSelect);
    renderVehicleDepartmentQuickSelect(bookingVehicleDepartmentQuickSelect);
    setDefaultVehicleDepartment(vehicleDepartmentQuickSelect);
    setDefaultVehicleDepartment(bookingVehicleDepartmentQuickSelect);
    renderDispatchVehicleOptions();
  }

  function renderDispatchVehicleOptions() {
    const vehicle = $("vehicleSelect");
    if (!vehicle) return;
    const current = vehicle.value;
    const dispatchVehicles = dispatchVehiclesFor(vehicleDepartmentQuickSelect);
    const loadingLabel = state.optionsLoading && !state.vehicles.length ? t("正在读取车辆…") : state.optionsError && !state.vehicles.length ? t("车辆选项读取失败，请重试") : t("请选择可调度车牌");
    vehicle.innerHTML = `<option value="">${loadingLabel}</option>` + dispatchVehicles.map((item) => `<option value="${escapeHtml(item.plate)}">${escapeHtml(item.plate)} · ${escapeHtml(item.modelDescription || t("车型未配置"))}</option>`).join("");
    if (dispatchVehicles.some((item) => item.plate === current)) vehicle.value = current;
    const bookingVehicle = $("bookingVehicleSelect"); if (!bookingVehicle) return; const bookingCurrent = bookingVehicle.value;
    const bookingDispatchVehicles = dispatchVehiclesFor(bookingVehicleDepartmentQuickSelect);
    bookingVehicle.innerHTML = `<option value="">${loadingLabel}</option>` + bookingDispatchVehicles.map((item) => `<option value="${escapeHtml(item.plate)}">${escapeHtml(item.plate)} · ${escapeHtml(item.modelDescription || t("车型未配置"))}</option>`).join("");
    if (bookingDispatchVehicles.some((item) => item.plate === bookingCurrent)) bookingVehicle.value = bookingCurrent;
    updateVehicleReadout();
    updateBookingReadout();
  }

  function vehicleEditorChoices(key, property, current = "") {
    const values = [];
    const seen = new Set();
    const add = (value) => { const clean = cleanDisplay(value); if (clean && !seen.has(clean)) { seen.add(clean); values.push(clean); } };
    state.vehicles.filter((item) => !state.editingVehicle || item.tableId === state.editingVehicle.tableId).forEach((item) => add(item[property]));
    (state.vehicleFieldOptions?.[key] || []).forEach(add);
    add(current);
    return values;
  }

  function setVehicleEditorSelect(id, values, placeholder, current = "") {
    const select = $(id);
    if (!select) return;
    const cleanCurrent = cleanDisplay(current);
    const normalized = [...new Set(values.map(cleanDisplay).filter(Boolean))];
    if (cleanCurrent && !normalized.includes(cleanCurrent)) normalized.unshift(cleanCurrent);
    select.innerHTML = `<option value="">${t(placeholder)}</option>` + normalized.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    select.value = cleanCurrent;
  }

  function renderVehicleTrackerOptions() {
    const select = $("vehicleTrackerInput");
    const hint = $("vehicleTrackerHint");
    if (!select) return;
    const vehicle = state.editingVehicle;
    const automaticMatch = vehicle ? trackerMatchForVehicle(vehicle) : null;
    const automaticRegistration = automaticMatch?.status === "matched" ? cleanDisplay(automaticMatch.snapshot?.registration) : "";
    const current = cleanDisplay(select.value || vehicle?.trackerRegistration || automaticRegistration);
    const trackers = Array.isArray(state.trackerStatus?.trackers) ? state.trackerStatus.trackers : [];
    const seen = new Set();
    const options = trackers.flatMap((tracker) => {
      const registration = cleanDisplay(tracker.registration);
      if (!registration) return [];
      const key = registration.toUpperCase().replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, "");
      if (seen.has(key)) return [];
      seen.add(key);
      const details = [registration, cleanDisplay(tracker.alias), cleanDisplay(tracker.vin)].filter(Boolean).join(" · ");
      return [{ value: registration, label: details }];
    });
    if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current });
    select.innerHTML = `<option value="">${escapeHtml(t("自动按 VIN / 车牌匹配"))}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}`;
    select.value = current;
    const canPersist = state.creatingVehicle || Boolean(vehicle?.trackerRegistrationField);
    select.disabled = false;
    if (hint) {
      hint.textContent = !canPersist
        ? t("已自动关联 Tracker 实时数据；车辆档案表未配置可写 Tracker 字段，当前不会回写编号。")
        : options.length
          ? automaticRegistration && !vehicle?.trackerRegistration
            ? t("已按车牌/VIN自动关联 Tracker；保存后会写回这个编号。")
            : t("选择已同步的 Tracker 车辆；保存后优先使用这个匹配。")
          : t("Tracker 数据尚未加载");
    }
    renderVehicleTrackerLiveStatus(vehicle);
  }

  function renderVehicleEditorOptions() {
    const vehicle = state.editingVehicle;
    const current = {
      brand: $("vehicleBrandInput")?.value || "",
      model: $("vehicleModelInput")?.value || "",
      type: $("vehicleTypeInput")?.value || "",
      status: $("vehicleStatusInput")?.value || "",
      owner: $("vehicleOwnerInput")?.value || "",
      registeringAuthority: $("vehicleRegisteringAuthorityInput")?.value || "",
      insurance: $("vehicleInsuranceInput")?.value || ""
    };
    setVehicleEditorSelect("vehicleBrandInput", vehicleEditorChoices("brand", "brand", current.brand), "请选择车辆品牌", current.brand);
    setVehicleEditorSelect("vehicleModelInput", vehicleEditorChoices("model", "model", current.model), "请选择车型", current.model);
    setVehicleEditorSelect("vehicleTypeInput", vehicleEditorChoices("type", "vehicleType", current.type), "请选择车辆类型", current.type);
    setVehicleEditorSelect("vehicleOwnerInput", vehicleEditorChoices("owner", "owner", current.owner), "请选择所属门店或部门", current.owner);
    setVehicleEditorSelect("vehicleRegisteringAuthorityInput", vehicleEditorChoices("registeringAuthority", "registeringAuthority", current.registeringAuthority), "请选择注册地点", current.registeringAuthority);
    const statusValues = vehicleEditorChoices("status", "status", current.status);
    if (state.creatingVehicle && !statusValues.includes("Sold")) statusValues.push("Sold");
    const statusSelect = $("vehicleStatusInput");
    if (statusSelect) {
      statusSelect.innerHTML = `<option value="">${t("未设置")}</option>` + statusValues.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      statusSelect.value = current.status;
    }
    const insuranceSelect = $("vehicleInsuranceInput");
    if (insuranceSelect) {
      const insuranceValues = vehicleEditorChoices("insurance", "insurance", current.insurance)
        .map((value) => /^yes$/i.test(value) ? "YES" : /^no$/i.test(value) ? "NO" : value)
        .filter((value, index, values) => value === "YES" || value === "NO" ? values.indexOf(value) === index : false);
      const values = insuranceValues.length ? insuranceValues : ["YES", "NO"];
      insuranceSelect.innerHTML = `<option value="">${t("请选择保险状态")}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
      const selected = /^yes$/i.test(current.insurance) ? "YES" : /^no$/i.test(current.insurance) ? "NO" : current.insurance;
      insuranceSelect.value = values.includes(selected) ? selected : "";
    }
    renderVehicleTrackerOptions();
  }

  const vehicleFieldLabels = { brand: "车辆品牌", model: "车型", type: "车辆类型", status: "车辆状态", owner: "所属门店 / 部门", registeringAuthority: "注册地点", insurance: "保险信息" };

  function vehicleOptionChip(option) {
    const value = String(option ?? "");
    const deleteLabel = state.language === "en" ? `Delete option ${value}` : `删除选项 ${value}`;
    const editLabel = state.language === "en" ? `Edit option ${value}` : `编辑选项 ${value}`;
    return `<span class="vehicle-option-chip" data-option-chip="${escapeHtml(value)}"><input class="vehicle-option-edit-input" data-option-edit="true" value="${escapeHtml(value)}" aria-label="${escapeHtml(editLabel)}" title="${escapeHtml(editLabel)}" /><button type="button" data-option-remove="true" aria-label="${escapeHtml(deleteLabel)}" title="${escapeHtml(deleteLabel)}"><span aria-hidden="true">×</span></button></span>`;
  }

  function renderVehicleOptionDefinitions() {
    const container = $("vehicleOptionsContent");
    if (!container) return;
    const tables = state.vehicleFieldDefinitions?.tables || [];
    if (!tables.length) { container.innerHTML = `<div class="empty-card">${t("暂无车辆字段选项")}</div>`; return; }
    container.innerHTML = tables.map((table) => `<section class="vehicle-option-table"><div class="vehicle-option-table-heading"><div><p class="eyebrow">${escapeHtml(table.tableName)}</p><h3>${escapeHtml(table.tableId)}</h3></div><small>${t("选项直接同步到此车辆档案表")}</small></div><div class="vehicle-option-fields">${(table.fields || []).map((field) => {
      const label = vehicleFieldLabels[field.key] || field.fieldName;
      if (field.type !== "select") return `<article class="vehicle-option-field vehicle-option-readonly"><div class="vehicle-option-field-heading"><strong>${escapeHtml(t(label))}</strong><small>${escapeHtml(field.fieldName)} · ${t("当前为文本字段")}</small></div><p>${t("此字段暂不能编辑选项；如需下拉，请先在多维表格中将字段转换为单选。")}</p></article>`;
      return `<article class="vehicle-option-field"><div class="vehicle-option-field-heading"><strong>${escapeHtml(t(label))}</strong><small>${escapeHtml(field.fieldName)} · ${field.multiple ? t("多选") : t("单选")}</small></div><div class="vehicle-option-chips" data-option-chips="${escapeHtml(`${table.tableId}:${field.fieldId}`)}">${(field.options || []).map(vehicleOptionChip).join("")}</div><div class="vehicle-option-add-row"><input data-option-input="${escapeHtml(`${table.tableId}:${field.fieldId}`)}" placeholder="${escapeHtml(t("新增选项"))}" /><button type="button" class="button button-quiet" data-option-add="true" data-table-id="${escapeHtml(table.tableId)}" data-field-id="${escapeHtml(field.fieldId)}">${t("添加")}</button><button type="button" class="button button-primary" data-option-save="true" data-table-id="${escapeHtml(table.tableId)}" data-field-id="${escapeHtml(field.fieldId)}">${t("同步保存")}</button></div></article>`;
    }).join("")}</div></section>`).join("");
  }

  async function loadVehicleOptionDefinitions() {
    const container = $("vehicleOptionsContent");
    if (container) container.innerHTML = `<div class="empty-card">${t("正在读取车辆字段选项…")}</div>`;
    try {
      const response = await fetch("/api/admin/vehicle-field-options", { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.vehicleFieldDefinitions = { tables: payload.tables || [] };
      renderVehicleOptionDefinitions();
    } catch (error) {
      if (container) container.innerHTML = `<div class="empty-card">${escapeHtml(`${t("读取车辆字段选项失败：")}${error.message}`)}</div>`;
    }
  }

  async function saveVehicleOption(tableId, fieldId) {
    const key = `${tableId}:${fieldId}`;
    const chips = [...document.querySelectorAll(`[data-option-chips="${CSS.escape(key)}"] [data-option-chip]`)].map((chip) => chip.querySelector("[data-option-edit]")?.value || chip.dataset.optionChip || "").map(cleanDisplay).filter(Boolean);
    const duplicate = chips.find((value, index) => chips.findIndex((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase()) !== index);
    if (duplicate) { setInlineStatus($("vehicleOptionsNotice"), `${t("选项不能重复：")}${duplicate}`, "error"); return; }
    if (!chips.length) { setInlineStatus($("vehicleOptionsNotice"), t("至少保留一个选项。"), "error"); return; }
    setInlineStatus($("vehicleOptionsNotice"), t("正在同步车辆字段选项…"));
    try {
      const response = await fetch("/api/admin/vehicle-field-options", { method: "PUT", headers: headers(), body: JSON.stringify({ tableId, fieldId, options: chips }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setInlineStatus($("vehicleOptionsNotice"), t("车辆字段选项已同步保存。"), "success");
      await loadVehicleOptionDefinitions();
      await loadOptions();
    } catch (error) {
      setInlineStatus($("vehicleOptionsNotice"), `${t("车辆字段选项保存失败：")}${error.message}`, "error");
      await loadVehicleOptionDefinitions();
    }
  }

  async function fetchOptionPayload(endpoint) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(endpoint, { headers: headers() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error("request failed");
  }

  async function loadOptions() {
    if (state.optionsLoading) return;
    state.optionsLoading = true;
    state.optionsError = "";
    renderDispatchVehicleOptions();
    setNotice("正在读取人员、车辆和门店选项…");
    const resources = [
      ["users", "/api/options/users", "人员"],
      ["vehicles", isMobile ? "/api/options/vehicles?compact=1" : "/api/options/vehicles", "车辆"],
      ["stores", "/api/options/stores", "门店"]
    ];
    if (!isMobile) {
      resources.push(["vehicleFieldOptions", "/api/options/vehicle-fields", "车辆字段选项"]);
      if (userCan("manage_vehicles")) resources.push(["vehicleFieldDefinitions", "/api/admin/vehicle-field-options", "车辆选项定义"]);
    }
    const errors = [];
    const loadResource = async ([key, endpoint, label]) => {
      try {
        const payload = await fetchOptionPayload(endpoint);
        state[key] = key === "vehicleFieldOptions" ? (payload.options || {}) : key === "vehicleFieldDefinitions" ? { tables: payload.tables || [] } : (payload[key] || []);
        saveOptionsCache();
        if (isMobile && key === "vehicles") {
          // Paint the small, usable vehicle selector before rendering the
          // large directory and desktop-only vehicle panels.
          renderDispatchVehicleOptions();
          window.setTimeout(() => renderOptions(), 0);
        } else {
          renderOptions();
        }
        if (!isMobile) {
          renderVehicleDepartmentFilter(); renderVehicles(); renderRows(); renderHistory(); renderTrackerHistoryVehicleOptions();
          renderVehicleEditorOptions();
          renderVehicleOptionDefinitions();
        }
      } catch (error) {
        errors.push(`${label}：${error.message}`);
        if (key === "vehicles") state.optionsError = error.message;
        renderDispatchVehicleOptions();
        renderOptions();
      }
    };
    try {
      const vehicleResource = resources.find(([key]) => key === "vehicles");
      if (isMobile && vehicleResource) {
        // The vehicle selector is the first interactive control on mobile.
        // Resolve it before the large directory response and its DOM work.
        await loadResource(vehicleResource);
        await Promise.all(resources.filter((resource) => resource !== vehicleResource).map(loadResource));
      } else {
        await Promise.all(resources.map(loadResource));
      }
      if (errors.length) setNotice(`部分选项读取失败：${errors.join("；")}`, "warning");
      else setNotice("人员、车辆和门店选项已就绪。", "success");
    } finally {
      state.optionsLoading = false;
      renderDispatchVehicleOptions();
    }
  }

  async function loadTasks() {
    setNotice("正在读取多维表格…");
    try {
      const response = await fetch("/api/tasks", { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.tasks = payload.tasks || [];
      renderStats(); renderRows(); renderBookingTable(); renderReturnPicker(); renderTransferPicker(); renderHistory();
      setNotice(`已同步 ${state.tasks.length} 条调度任务。`, "success");
    } catch (error) { setNotice(`读取失败：${error.message}`, "error"); }
  }

  async function loadNotificationSettings() {
    if (!userCan("manage_notifications")) return;
    try {
      const response = await fetch("/api/admin/notification-settings", { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.notificationSettings = payload.departments || [];
      if (payload.reminders && typeof payload.reminders === "object") state.notificationReminders = payload.reminders;
      renderNotificationSettings();
    } catch (error) {
      setInlineStatus($("notificationSettingsNotice"), `通知设置读取失败：${error.message}`, "error");
    }
  }

  /* Deprecated draft kept inert for browser compatibility; renderer is defined below.
  const notificationStageKey = { departure: "departureTargets", return: "returnTargets", booking: "bookingTargets" };

  function notificationRule(department) {
    return state.notificationSettings.find((rule) => rule.department === department);
  }

  function notificationUserOptions(selectedId) {
    const users = [...state.users].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return `<option value="">选择 Lark 联系人</option>${{users.map((user) => `<option value="${{escapeHtml(user.id)}" ${{user.id === selectedId ? "selected" : ""}>${{escapeHtml(user.name)}${{user.department ? " · " + escapeHtml(user.department) : ""}</option>`).join("")}`;
  }

  function renderNotificationTarget(target, department, stage) {
    return `<span class="notification-target"><span>${{escapeHtml(target.type === "chat" ? "群" : "人")} · ${{escapeHtml(target.label || target.id)}</span><button type="button" data-notify-remove="true" data-notify-department="${{escapeHtml(department)}" data-notify-stage="${{escapeHtml(stage)}" data-notify-type="${{escapeHtml(target.type)}" data-notify-id="${{escapeHtml(target.id)}" aria-label="移除通知目标">×</button></span>`;
  }

  function renderNotificationSettings() {
    if (!notificationSettingsContent) return;
    if (!state.notificationSettings.length) { notificationSettingsContent.innerHTML = `<div class="empty-card">暂无通知设置。</div>`; return; }
    notificationSettingsContent.innerHTML = state.notificationSettings.map((rule) => {
      const label = rule.department === "default" ? "默认通知（未匹配部门时使用）" : ({ administration: "行政部", maintenance: "维护部", operations: "运营部", procurement: "采购部", warehouse: "仓库部", store: "门店部", tophida: "Tophida" }[rule.department] || rule.department);
      return `<section class="notification-department"><div class="notification-department-heading"><h3>${{escapeHtml(label)}</h3><small>${{rule.department === "default" ? "未匹配部门时使用" : "按车辆所属部门匹配"}</small></div><div class="notification-stage-grid">${{notificationStages.map(([stage, stageLabel]) => {
        const targets = rule[notificationStageKey[stage]] || [];
        return `<div class="notification-stage"><strong>${{stageLabel}</strong><div class="notification-targets">${{targets.length ? targets.map((target) => renderNotificationTarget(target, rule.department, stage)).join("") : `<span class="notification-empty">未设置</span>`}</div><div class="notification-add-row"><select data-notify-user="${{escapeHtml(rule.department)}" data-notify-stage="${{escapeHtml(stage)}">${{notificationUserOptions("")}</select><button type="button" class="button button-quiet" data-notify-add-user="true" data-notify-department="${{escapeHtml(rule.department)}" data-notify-stage="${{escapeHtml(stage)}">添加联系人</button></div><div class="notification-add-row"><input data-notify-chat="${{escapeHtml(rule.department)}" data-notify-stage="${{escapeHtml(stage)}" placeholder="群聊 ID，例如 oc_xxx" /><button type="button" class="button button-quiet" data-notify-add-chat="true" data-notify-department="${{escapeHtml(rule.department)}" data-notify-stage="${{escapeHtml(stage)}">添加群聊</button></div></div>`;
      }).join("")}</div></section>`;
    }).join("");
  }

  function addNotificationTarget(department, stage, target) {
    const rule = notificationRule(department);
    if (!rule || !target.id) return;
    const key = ${{target.type}:${{target.id};
    const targets = rule[notificationStageKey[stage]] || [];
    if (targets.some((item) => ${{item.type}:${{item.id} === key)) return;
    targets.push({ type: target.type, id: target.id, label: target.label || target.id });
    rule[notificationStageKey[stage]] = targets;
    renderNotificationSettings();
  }

  function removeNotificationTarget(department, stage, type, id) {
    const rule = notificationRule(department);
    if (!rule) return;
    rule[notificationStageKey[stage]] = (rule[notificationStageKey[stage]] || []).filter((target) => !(target.type === type && target.id === id));
    renderNotificationSettings();
  }

  async function saveNotificationSettings() {
    setInlineStatus($("notificationSettingsNotice"), "正在保存通知设置…");
    try {
      const response = await fetch("/api/admin/notification-settings", { method: "PUT", headers: headers(), body: JSON.stringify({ departments: state.notificationSettings }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${{response.status}`);
      state.notificationSettings = payload.departments || state.notificationSettings;
      renderNotificationSettings();
      setInlineStatus($("notificationSettingsNotice"), "通知设置已保存。", "success");
    } catch (error) { setInlineStatus($("notificationSettingsNotice"), `通知设置保存失败：${{error.message}`, "error"); }
  }

  function openSettings() {
    if (isMobile) { window.location.href = "/"; return; }
    document.body.classList.remove("editor-mode");
    showOnly("settings");
    renderNotificationSettings();
    const photoSyncResult = new URLSearchParams(window.location.search);
    if (!photoSyncResult.has("photo_sync") && !photoSyncResult.has("photo_sync_error")) history.replaceState(null, "", "?view=settings");
  }

  function openVehicleOptions() {
    if (isMobile) { window.location.href = "/"; return; }
    document.body.classList.remove("editor-mode");
    showOnly("vehicleOptions");
    renderVehicleOptionDefinitions();
    history.replaceState(null, "", "?view=vehicle-options");
    if (!state.vehicleFieldDefinitions?.tables?.length) void loadVehicleOptionDefinitions();
  }
  */

  const notificationStages = [["departure", "出发通知"], ["return", "返程通知"], ["booking", "预约通知"], ["maintenance", "保养提醒"], ["inspection", "年检提醒"]];
  const notificationStageKey = { departure: "departureTargets", return: "returnTargets", booking: "bookingTargets", maintenance: "maintenanceTargets", inspection: "inspectionTargets" };

  function notificationRule(department) {
    return state.notificationSettings.find((rule) => rule.department === department);
  }

  function notificationUserOptions(selectedId) {
    const users = [...state.users].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return `<option value="">选择 Lark 联系人</option>${users.map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === selectedId ? "selected" : ""}>${escapeHtml(user.name)}${user.department ? " · " + escapeHtml(user.department) : ""}</option>`).join("")}`;
  }

  function renderNotificationTarget(target, department, stage) {
    return `<span class="notification-target"><span>${escapeHtml(target.type === "chat" ? "群" : "人")} · ${escapeHtml(target.label || target.id)}</span><button type="button" data-notify-remove="true" data-notify-department="${escapeHtml(department)}" data-notify-stage="${escapeHtml(stage)}" data-notify-type="${escapeHtml(target.type)}" data-notify-id="${escapeHtml(target.id)}" aria-label="移除通知目标">×</button></span>`;
  }

  function renderNotificationSettings() {
    if (!notificationSettingsContent) return;
    const reminder = (kind, label) => {
      const rule = state.notificationReminders[kind] || {};
      const mileage = kind === "maintenance" ? `<label>提前公里数<input type="number" min="0" max="1000000" step="100" data-reminder-field="${kind}.mileageBefore" value="${escapeHtml(rule.mileageBefore ?? 1000)}" /></label>` : "";
      return `<div class="notification-reminder-rule"><div class="notification-reminder-title"><strong>${label}</strong><label class="notification-toggle"><input type="checkbox" data-reminder-field="${kind}.enabled" ${rule.enabled !== false ? "checked" : ""} /><span>启用</span></label></div><label>提前天数<input type="number" min="0" max="3650" step="1" data-reminder-field="${kind}.daysBefore" value="${escapeHtml(rule.daysBefore ?? 30)}" /></label>${mileage}<label>发送间隔（小时）<input type="number" min="1" max="8760" step="1" data-reminder-field="${kind}.frequencyHours" value="${escapeHtml(rule.frequencyHours ?? 24)}" /></label><label>最多发送次数<input type="number" min="1" max="100" step="1" data-reminder-field="${kind}.maxSends" value="${escapeHtml(rule.maxSends ?? 3)}" /></label></div>`;
    };
    const reminderSettings = `<section class="notification-reminder-settings"><div class="notification-department-heading"><div><h3>车辆提醒规则</h3><small>提醒会按车辆所属部门匹配联系人；没有单独设置时沿用预约通知目标。</small></div></div><div class="notification-reminder-grid">${reminder("maintenance", "保养临近")}${reminder("inspection", "年检临近")}</div></section>`;
    if (!state.notificationSettings.length) { notificationSettingsContent.innerHTML = `${reminderSettings}<div class="empty-card">暂无通知设置。</div>`; return; }
    notificationSettingsContent.innerHTML = `${reminderSettings}${state.notificationSettings.map((rule) => {
      const label = rule.department === "default" ? "默认通知（未匹配部门时使用）" : ({ administration: "行政部", maintenance: "维护部", operations: "运营部", procurement: "采购部", warehouse: "仓库部", store: "门店部", tophida: "Tophida" }[rule.department] || rule.department);
      return `<section class="notification-department"><div class="notification-department-heading"><h3>${escapeHtml(label)}</h3><small>${rule.department === "default" ? "未匹配部门时使用" : "按车辆所属部门匹配"}</small></div><div class="notification-stage-grid">${notificationStages.map(([stage, stageLabel]) => {
        const targets = rule[notificationStageKey[stage]] || [];
        return `<div class="notification-stage"><strong>${stageLabel}</strong><div class="notification-targets">${targets.length ? targets.map((target) => renderNotificationTarget(target, rule.department, stage)).join("") : `<span class="notification-empty">未设置</span>`}</div><div class="notification-add-row"><select data-notify-user="${escapeHtml(rule.department)}" data-notify-stage="${escapeHtml(stage)}">${notificationUserOptions("")}</select><button type="button" class="button button-quiet" data-notify-add-user="true" data-notify-department="${escapeHtml(rule.department)}" data-notify-stage="${escapeHtml(stage)}">添加联系人</button></div><div class="notification-add-row"><input data-notify-chat="${escapeHtml(rule.department)}" data-notify-stage="${escapeHtml(stage)}" placeholder="群聊 ID，例如 oc_xxx" /><button type="button" class="button button-quiet" data-notify-add-chat="true" data-notify-department="${escapeHtml(rule.department)}" data-notify-stage="${escapeHtml(stage)}">添加群聊</button></div></div>`;
      }).join("")}</div></section>`;
    }).join("")}`;
  }

  function addNotificationTarget(department, stage, target) {
    const rule = notificationRule(department);
    if (!rule || !target.id) return;
    const key = `${target.type}:${target.id}`;
    const targets = rule[notificationStageKey[stage]] || [];
    if (targets.some((item) => `${item.type}:${item.id}` === key)) return;
    targets.push({ type: target.type, id: target.id, label: target.label || target.id });
    rule[notificationStageKey[stage]] = targets;
    renderNotificationSettings();
  }

  function removeNotificationTarget(department, stage, type, id) {
    const rule = notificationRule(department);
    if (!rule) return;
    rule[notificationStageKey[stage]] = (rule[notificationStageKey[stage]] || []).filter((target) => !(target.type === type && target.id === id));
    renderNotificationSettings();
  }

  async function saveNotificationSettings() {
    setInlineStatus($("notificationSettingsNotice"), "正在保存通知设置…");
    try {
      const response = await fetch("/api/admin/notification-settings", { method: "PUT", headers: headers(), body: JSON.stringify({ departments: state.notificationSettings, reminders: state.notificationReminders }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.notificationSettings = payload.departments || state.notificationSettings;
      state.notificationReminders = payload.reminders || state.notificationReminders;
      renderNotificationSettings();
      setInlineStatus($("notificationSettingsNotice"), "通知设置已保存。", "success");
    } catch (error) { setInlineStatus($("notificationSettingsNotice"), `通知设置保存失败：${error.message}`, "error"); }
  }

  function openSettings() {
    if (isMobile) { window.location.href = "/"; return; }
    document.body.classList.remove("editor-mode");
    showOnly("settings");
    renderNotificationSettings();
    const photoSyncResult = new URLSearchParams(window.location.search);
    if (!photoSyncResult.has("photo_sync") && !photoSyncResult.has("photo_sync_error")) history.replaceState(null, "", "?view=settings");
  }

  function openVehicleOptions() {
    if (isMobile) { window.location.href = "/"; return; }
    document.body.classList.remove("editor-mode");
    showOnly("vehicleOptions");
    renderVehicleOptionDefinitions();
    history.replaceState(null, "", "?view=vehicle-options");
    if (!state.vehicleFieldDefinitions?.tables?.length) void loadVehicleOptionDefinitions();
  }
  async function syncNow() {
    setNotice("正在执行同步…");
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: headers(), body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await loadTasks();
      setNotice(`同步完成：扫描 ${payload.scanned} 条，入队 ${payload.queued} 条，执行 ${payload.executed} 条。`, "success");
    } catch (error) { setNotice(`同步失败：${error.message}`, "error"); }
  }

  function setDefaultDateTime(input) {
    if (input.value) return;
    const date = new Date();
    input.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function setDefaultDeparture() { setDefaultDateTime(form.elements.departureTime); }

  function resetBooking() {
    bookingForm.reset();
    clearFormDirty();
    if (bookingVehicleDepartmentQuickSelect) bookingVehicleDepartmentQuickSelect.dataset.departmentTouched = "";
    setDefaultDateTime($("bookingDepartureTime"));
    $("bookingVehicleReadout").textContent = t("选择车牌后显示车型描述");
    $("bookingNotice").textContent = "";
    $("bookingHistoryLink").hidden = true;
    renderOptions();
    setDefaultRequester("bookingRequesterSelect", "bookingRequesterInput", "bookingRequesterMatchStatus");
  }

  function updateBookingReadout() {
    const vehicle = vehicleByPlate($("bookingVehicleSelect").value);
    if (!vehicle) { $("bookingVehicleReadout").textContent = t("选择车牌后显示车型描述"); return; }
    const mileage = vehicle.mileage === null ? t("档案未填写当前公里数") : `${t("档案当前")} ${formatMileage(vehicle.mileage)}`;
    $("bookingVehicleReadout").textContent = `${vehicle.modelDescription || t("车型未配置")} · ${vehicle.plate} · ${mileage}`;
  }

  function bookingFieldsFromForm(data) {
    const departure = String(data.get("departureTime") || "").trim();
    const fields = {
      // Lark Bitable datetime cells are written as Unix milliseconds. An ISO
      // string is rejected by some table schemas with DatetimeFieldConvFail.
      "出发时间": departure ? new Date(departure).getTime() : "",
      "起点": String(data.get("origin") || "").trim(),
      "目的地": String(data.get("destination") || "").trim(),
      "车辆": String(data.get("vehicle") || "").trim()
    };
    const requesterId = selectedPerson($("bookingRequesterSelect"));
    if (requesterId) fields["申请人"] = [{ id: requesterId }];
    return fields;
  }

  async function saveBooking(event) {
    event.preventDefault();
    if (bookingForm.querySelector('button[type="submit"]')?.disabled) return;
    matchRequesterInput("bookingRequesterInput", "bookingRequesterSelect", "bookingRequesterMatchStatus");
    if (!selectedPerson($("bookingRequesterSelect"))) { setInlineStatus(bookingRequesterMatchStatus, "未匹配到公司人员，请从建议中选择", "error"); return; }
    const fields = bookingFieldsFromForm(new FormData(bookingForm));
    setBookingSubmitBusy(true);
    setInlineStatus($("bookingNotice"), "正在提交车辆预约…");
    try {
      const response = await fetch("/api/bookings", { method: "POST", headers: headers(), body: JSON.stringify({ fields, clientToken: crypto.randomUUID() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const notificationMessage = payload.notification?.sent ? ` 已通知 ${payload.notification.sent} 个 Lark 目标。` : payload.notification?.skipped === "未配置通知目标" ? " 尚未配置该部门的 Lark 通知目标。" : payload.notification?.failed ? ` ${payload.notification.failed} 个通知发送失败。` : "";
      setInlineStatus($("bookingNotice"), `预约已创建。${notificationMessage}`, "success");
      clearFormDirty();
      $("bookingHistoryLink").hidden = false;
      await loadTasks();
    } catch (error) { setInlineStatus($("bookingNotice"), `提交车辆预约失败：${error.message}`, "error"); }
    finally { setBookingSubmitBusy(false); }
  }

  async function decideBooking(recordId, decision) {
    const approving = decision === "approve";
    const task = state.tasks.find((item) => item.recordId === recordId);
    const label = task?.taskNumber || recordId;
    if (!window.confirm(approving ? `确认同意车辆预约 ${label} 并排程？` : `确认拒绝车辆预约 ${label}？`)) return;
    setNotice(approving ? "正在确认预约并排程…" : "正在拒绝车辆预约…");
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(recordId)}/decision`, { method: "POST", headers: headers(), body: JSON.stringify({ decision }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      await loadTasks();
      setNotice(approving ? "车辆预约已同意，状态已更新为已排程。" : "车辆预约已拒绝并保留记录。", "success");
      playConfirmationFeedback(notice);
    } catch (error) {
      setNotice(`预约处理失败：${error.message}`, "error");
    }
  }

  function resetPhotos(phase) {
    state.photos[phase] = {}; state.photoCapturedAt[phase] = {};
    document.querySelectorAll(`input[data-photo-phase="${phase}"]`).forEach((input) => { input.value = ""; });
    document.querySelectorAll(`[id^="${phase}Preview"]`).forEach((preview) => { preview.innerHTML = "＋"; preview.className = "photo-preview"; });
  }

  function resetEditor() {
    state.editingRecordId = "";
    clearFormDirty();
    form.reset(); resetPhotos("departure"); resetPhotos("return");
    $("formTitle").textContent = t(view === "departure" ? "出发登记" : isTransferView ? "中转登记" : "新建调度");
    $("formSubmitButton").textContent = t(view === "departure" ? "提交出发登记" : isTransferView ? "提交中转登记" : "创建调度任务");
    $("cancelEditButton").hidden = true;
    $("returnSection").hidden = true;
    if (returnOriginInput) returnOriginInput.value = "";
    if (returnDestinationInput) returnDestinationInput.value = "";
    if (returnOriginQuickSelect) returnOriginQuickSelect.value = "";
    if (returnDestinationQuickSelect) returnDestinationQuickSelect.value = "";
    form.hidden = false;
    $("transferSection").hidden = true;
    if ($("transferLocationInput")) $("transferLocationInput").value = "";
    if ($("transferLocationQuickSelect")) $("transferLocationQuickSelect").value = "";
    $("returnMileage").value = ""; $("damageDescription").value = ""; $("returnNotice").textContent = "";
    $("departureCheckResult").value = "外观正常"; $("departurePhotoNotes").value = "";
    $("returnCheckResult").value = "外观正常"; $("returnPhotoNotes").value = "";
    setInlineStatus($("departurePhotoStatus"), "照片保持原始分辨率，并添加时间、阶段和方位水印；不采集位置。");
    setInlineStatus(vehicleStatus, "车辆公里数和保养里程会自动带出");
    $("vehicleModel").textContent = t("选择车牌后显示车型描述");
    if (requesterInput) { requesterInput.value = ""; requesterInput.setCustomValidity(""); }
    if (bookingRequesterInput) { bookingRequesterInput.value = ""; bookingRequesterInput.setCustomValidity(""); }
    if (vehicleDepartmentQuickSelect) vehicleDepartmentQuickSelect.value = "";
    if (vehicleDepartmentQuickSelect) vehicleDepartmentQuickSelect.dataset.departmentTouched = "";
    if (bookingVehicleDepartmentQuickSelect) { bookingVehicleDepartmentQuickSelect.value = ""; bookingVehicleDepartmentQuickSelect.dataset.departmentTouched = ""; }
    setDefaultDeparture();
    setDefaultRequester("requesterSelect", "requesterInput", "requesterMatchStatus");
  }

  function localizeEditorChrome() {
    const currentFlow = state.mobileFlow || view;
    $("formTitle").textContent = state.editingRecordId ? `${t("编辑任务")} ${form.elements.taskNumber.value || ""}` : t(currentFlow === "departure" ? "出发登记" : currentFlow === "transfer" ? "中转登记" : "新建调度");
    $("formSubmitButton").textContent = t(state.editingRecordId ? "保存修改" : currentFlow === "departure" ? "提交出发登记" : currentFlow === "transfer" ? "提交中转登记" : "创建调度任务");
    if (isMobile) $("backToOverviewButton").textContent = t(currentFlow === "return" ? "返回选择返程任务" : currentFlow === "transfer" ? "返回选择中转任务" : "返回选择操作");
  }

  function ensureOption(select, value, label) {
    if (!value || [...select.options].some((option) => option.value === value)) return;
    const option = document.createElement("option"); option.value = value; option.textContent = label || value; option.dataset.fallback = "true"; select.append(option);
  }

  function openEditor(task = null, preferredPlate = "") {
    if (isMobile && !task) state.mobileFlow = "departure";
    document.body.classList.remove("return-mode");
    document.body.classList.add("editor-mode"); resetEditor();
    if (task) {
      state.editingRecordId = task.recordId;
      ensureOption($("requesterSelect"), task.requesterId || task.requester, task.requester || task.requesterId);
      $("requesterSelect").value = task.requesterId || task.requester || "";
      $("requesterInput").value = task.requester || task.requesterId || "";
      $("originInput").value = task.origin || ""; $("destinationInput").value = task.destination || "";
      if (returnOriginInput) returnOriginInput.value = task.returnOrigin || task.transferLocation || task.destination || "";
      if (returnDestinationInput) returnDestinationInput.value = task.returnDestination || task.origin || "";
      form.elements.taskNumber.value = task.taskNumber || "";
      form.elements.departureTime.value = task.departureTime ? new Date(task.departureTime).toISOString().slice(0, 16) : "";
      form.elements.mileage.value = task.mileage ?? "";
      ensureOption($("vehicleSelect"), task.vehicle, task.vehicle); $("vehicleSelect").value = task.vehicle || "";
      const taskVehicle = vehicleByPlate(task.vehicle); if (taskVehicle && vehicleDepartmentQuickSelect) vehicleDepartmentQuickSelect.value = vehicleDepartment(taskVehicle);
      form.elements.nextMaintenanceMileage.value = task.nextMaintenanceMileage ?? ""; form.elements.status.value = task.status || "待调度";
      $("formTitle").textContent = `${t("编辑任务")} ${task.taskNumber || ""}`; $("formSubmitButton").textContent = t("保存修改"); $("cancelEditButton").hidden = false;
      $("returnSection").hidden = false; $("returnMileage").value = task.returnMileage ?? ""; $("damageDescription").value = task.damageDescription || "";
      $("departureCheckResult").value = task.departureCheckResult || "外观正常"; $("departurePhotoNotes").value = task.departurePhotoNotes || "";
      $("returnCheckResult").value = task.returnCheckResult || "外观正常"; $("returnPhotoNotes").value = task.returnPhotoNotes || "";
      renderExistingPhotos(task, "departure"); renderExistingPhotos(task, "return"); updateVehicleReadout();
      if (!isMobile) history.replaceState(null, "", `?view=edit&record=${encodeURIComponent(task.recordId)}`);
    } else if (preferredPlate) {
      ensureOption($("vehicleSelect"), preferredPlate, preferredPlate); $("vehicleSelect").value = preferredPlate; updateVehicleReadout();
      const preferredVehicle = vehicleByPlate(preferredPlate); if (preferredVehicle && vehicleDepartmentQuickSelect) vehicleDepartmentQuickSelect.value = vehicleDepartment(preferredVehicle);
      if (!isMobile) history.replaceState(null, "", `?view=edit&vehicle=${encodeURIComponent(preferredPlate)}`);
    }
    const useTaskTransition = Boolean(task && !$("overviewView").hidden);
    if (useTaskTransition) document.documentElement.dataset.taskTransition = "active";
    const transition = showOnly("editor");
    if (useTaskTransition) {
      if (transition?.finished) transition.finished.finally(() => { delete document.documentElement.dataset.taskTransition; });
      else delete document.documentElement.dataset.taskTransition;
    }
    form.scrollIntoView({ behavior: contextualScrollBehavior(), block: "start" });
  }

  function openReturn(task) {
    state.mobileFlow = "return";
    openEditor(task); $("returnSection").hidden = false;
    localizeEditorChrome();
    $("returnSection").scrollIntoView({ behavior: contextualScrollBehavior(), block: "start" });
    history.replaceState(null, "", `?view=return&record=${encodeURIComponent(task.recordId)}`);
  }

  function openTransfer(task) {
    if (!task) { showTransferPicker(); return; }
    state.mobileFlow = "transfer";
    openEditor(task);
    localizeEditorChrome();
    form.hidden = true;
    $("returnSection").hidden = true;
    $("transferSection").hidden = false;
    $("transferTaskSummary").innerHTML = `<strong>${escapeHtml(task.vehicle || t("未分配车辆"))}</strong><span>${escapeHtml(task.taskNumber || t("未编号"))} · ${escapeHtml(taskRoute(task) || "—")}</span><small>${escapeHtml(task.requester || t("未填写"))} · ${escapeHtml(formatDate(task.departureTime))}</small>`;
    if (transferLocationInput) transferLocationInput.value = task.transferLocation || "";
    if (transferLocationQuickSelect) transferLocationQuickSelect.value = task.transferLocation && state.stores.some((store) => store.name === task.transferLocation) ? task.transferLocation : "";
    $("formTitle").textContent = t("中转登记");
    $("transferSubmitButton").textContent = task.transferLocation ? t("更新中转登记") : t("提交中转登记");
    setInlineStatus(transferNotice, "");
    $("transferSection").scrollIntoView({ behavior: contextualScrollBehavior(), block: "start" });
    history.replaceState(null, "", `?view=transfer&record=${encodeURIComponent(task.recordId)}`);
  }

  function navigateMobileFlow(next) {
    if (!isMobile) return false;
    history.pushState(null, "", `?view=${encodeURIComponent(next)}`);
    if (next === "departure") openEditor();
    else if (next === "return") showReturnPicker();
    else if (next === "transfer") showTransferPicker();
    else showMobileHome();
    return true;
  }

  function backFromTaskEditor() {
    if (isMobile) {
      if (state.mobileFlow === "return") return navigateMobileFlow("return");
      if (state.mobileFlow === "transfer") return navigateMobileFlow("transfer");
      return showOverview();
    }
    return showOverview();
  }

  function renderExistingPhotos(task, phase) {
    const photos = phase === "departure" ? task.departurePhotos : task.returnPhotos;
    if (!photos?.length) return;
    photos.slice(0, 5).forEach((photo, index) => {
      const position = allPhotoPositions[index]; const preview = photoPreview(phase, position);
      if (!preview || !photo.url) return;
      preview.innerHTML = `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name)}" width="640" height="480" /><small>${t("已上传")}</small>`; preview.classList.add("has-image");
    });
  }

  function photoPreview(phase, position) {
    return document.querySelector(`input[data-photo-phase="${phase}"][data-photo-position="${position}"]`)?.closest(".photo-slot")?.querySelector(".photo-preview") || $(`${phase}Preview${position[0].toUpperCase()}${position.slice(1)}`);
  }

  function updateVehicleReadout() {
    const vehicle = vehicleByPlate($("vehicleSelect").value);
    if (!vehicle) { $("vehicleModel").textContent = t("选择车牌后显示车型描述"); return; }
    $("vehicleModel").textContent = `${vehicle.modelDescription || t("车型未配置")} · ${vehicle.plate}`;
    if (!String(form.elements.nextMaintenanceMileage.value || "").trim() && vehicle.nextMaintenanceMileage !== null) form.elements.nextMaintenanceMileage.value = vehicle.nextMaintenanceMileage;
    const current = vehicle.mileage === null ? t("档案未填写当前公里数") : `${t("档案当前")} ${formatMileage(vehicle.mileage)}`;
    const next = vehicle.nextMaintenanceMileage === null ? t("未设置下次保养里程") : `${t("下次保养")} ${formatMileage(vehicle.nextMaintenanceMileage)}`;
    setInlineStatus(vehicleStatus, `${vehicle.tableName} · ${current} · ${next}`, "success");
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取图片")); }; image.src = url; });
  }

  function canvasToDataUrl(canvas, mimeType, quality = 1) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => { if (!blob) return reject(new Error("图片转换失败")); const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片转换失败")); reader.readAsDataURL(blob); }, mimeType, quality));
  }

  async function preparePhoto(file, watermarkLines) {
    const image = await fileToImage(file);
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const boxHeight = Math.max(62, Math.round(canvas.height * 0.1)); context.fillStyle = "rgba(8, 14, 28, .72)"; context.fillRect(0, canvas.height - boxHeight, canvas.width, boxHeight); context.fillStyle = "#ffffff"; context.font = `${Math.max(15, Math.round(canvas.width / 55))}px sans-serif`;
    watermarkLines.forEach((line, index) => context.fillText(line, Math.max(16, Math.round(canvas.width * .025)), canvas.height - boxHeight + 26 + index * Math.max(20, Math.round(canvas.width / 62))));
    const mimeType = ["image/png", "image/webp"].includes(file.type) ? file.type : "image/jpeg";
    return canvasToDataUrl(canvas, mimeType);
  }

  async function prepareVehicleProfilePhoto(file) {
    const image = await fileToImage(file);
    const makeVariant = async (maxDimension, quality) => {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法处理图片");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const mimeType = "image/jpeg";
      return new Promise((resolve, reject) => canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("图片转换失败"));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片转换失败"));
        reader.readAsDataURL(blob);
      }, mimeType, quality));
    };
    return { full: await makeVariant(2560, .96), thumbnail: await makeVariant(640, .84) };
  }

  async function processPhoto(phase, position, file) {
    try {
      const capturedAt = state.photoCapturedAt[phase][position] || new Date().toISOString(); state.photoCapturedAt[phase][position] = capturedAt;
      const dataUrl = await preparePhoto(file, [`${t(phase === "departure" ? "出发前" : "返程")} · ${positionLabel(position)}`, formatDate(capturedAt)]);
      state.photos[phase][position] = { position, dataUrl, capturedAt };
      const preview = photoPreview(phase, position); if (!preview) return; preview.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(positionLabel(position))} ${t("照片")}" width="640" height="480" /><small>${escapeHtml((file.size / 1024).toFixed(0))} KB · ${t("已加时间水印")}</small>`; preview.classList.add("has-image");
      const status = phase === "departure" ? $("departurePhotoStatus") : $("returnPhotoStatus"); setInlineStatus(status, `${Object.keys(state.photos[phase]).length}/5 ${t("张照片已准备，提交时上传。")}`, "success");
    } catch (error) { setInlineStatus(phase === "departure" ? $("departurePhotoStatus") : $("returnPhotoStatus"), `处理照片失败：${error.message}`, "error"); }
  }

  function photoPayloads(phase) { return allPhotoPositions.map((position) => state.photos[phase][position]).filter(Boolean); }
  function validatePhotoSet(phase, required) {
    const standardCount = photoPositions.filter((position) => state.photos[phase][position]).length; const total = photoPayloads(phase).length;
    if (!required && total === 0) return true;
    if (standardCount !== 4) { setInlineStatus(phase === "departure" ? $("departurePhotoStatus") : $("returnPhotoStatus"), "请补齐前、后、左、右四张照片；补充照片为选填。", "error"); return false; }
    return true;
  }

  function fieldsFromForm(data) {
    const departure = String(data.get("departureTime") || "").trim();
    const status = view === "departure" ? "执行中" : String(data.get("status") || "待调度");
    const fields = { "出发时间": departure ? new Date(departure).getTime() : "", "起点": data.get("origin"), "目的地": data.get("destination"), "车辆": data.get("vehicle"), "调度状态": status };
    const mileage = String(data.get("mileage") || "").trim(); if (mileage) fields["当前公里数"] = Number(mileage);
    const next = String(data.get("nextMaintenanceMileage") || "").trim(); if (next) fields["下次保养公里数"] = Number(next);
    const requesterId = selectedPerson($("requesterSelect")); if (requesterId) fields["申请人"] = [{ id: requesterId }];
    return fields;
  }

  async function uploadDeparturePhotos(recordId) {
    const photos = photoPayloads("departure"); if (!photos.length) return null;
    const response = await fetch(`/api/tasks/${encodeURIComponent(recordId)}/photos`, { method: "POST", headers: headers(), body: JSON.stringify({ phase: "departure", photos, checkResult: $("departureCheckResult").value, photoNotes: $("departurePhotoNotes").value }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`); return payload;
  }

  async function saveTask(event) {
    event.preventDefault();
    const submitButton = $("formSubmitButton");
    if (submitButton?.disabled) return;
    matchRequesterInput("requesterInput", "requesterSelect", "requesterMatchStatus");
    const data = new FormData(form); const editing = Boolean(state.editingRecordId); const fields = fieldsFromForm(data);
    if (!validatePhotoSet("departure", !editing)) return;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel = submitButton.textContent || "";
    }
    setNotice(editing ? "正在保存调度记录…" : "正在创建调度记录…");
    try {
      const response = await fetch(editing ? `/api/tasks/${encodeURIComponent(state.editingRecordId)}` : "/api/tasks", { method: editing ? "PATCH" : "POST", headers: headers(), body: JSON.stringify(editing ? { fields } : { fields, clientToken: crypto.randomUUID() }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const recordId = payload.recordId; let photoMessage = "";
      if (photoPayloads("departure").length) {
        setNotice(`调度记录已创建，正在后台上传 ${photoPayloads("departure").length} 张出发照片…`);
        const photoResult = await uploadDeparturePhotos(recordId);
        photoMessage = ` 已上传出发照片 ${photoResult.uploaded} 张。`;
        if (photoResult.notification?.sent) photoMessage += ` 已通知 ${photoResult.notification.sent} 个 Lark 目标。`;
      }
      const syncMessage = payload.vehicleSync?.message ? ` ${payload.vehicleSync.message}` : "";
      clearFormDirty();
      if (isMobile) { window.location.href = "?view=apply"; return; }
      resetEditor(); showOverview(); await Promise.all([loadTasks(), loadOptions()]); setNotice(editing ? `任务已更新。${photoMessage}${syncMessage}` : `任务已创建：${recordId}。${photoMessage}${syncMessage}`, "success");
    } catch (error) { setNotice(`保存失败：${error.message}`, "error"); }
    finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitButton.dataset.originalLabel || submitButton.textContent;
      }
    }
  }

  async function submitReturn() {
    if (!state.editingRecordId) return setInlineStatus($("returnNotice"), "请先选择一条调度任务。", "error");
    const mileage = Number($("returnMileage").value); if (!Number.isFinite(mileage) || mileage < 0) return setInlineStatus($("returnNotice"), "请填写有效的返程公里数。", "error");
    if (!validatePhotoSet("return", true)) return;
    setInlineStatus($("returnNotice"), "正在上传返程照片并回写公里数…");
    try {
      const returnOrigin = returnOriginInput?.value.trim() || "";
      const returnDestination = returnDestinationInput?.value.trim() || "";
      if (!returnOrigin || !returnDestination) return setInlineStatus($("returnNotice"), "请填写返程起点和返程目的地。", "error");
      const response = await fetch(`/api/tasks/${encodeURIComponent(state.editingRecordId)}/return`, { method: "POST", headers: headers(), body: JSON.stringify({ returnOrigin, returnDestination, returnMileage: mileage, damageDescription: $("damageDescription").value, checkResult: $("returnCheckResult").value, photoNotes: $("returnPhotoNotes").value, photos: photoPayloads("return") }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const notificationMessage = payload.notification?.sent ? ` 已通知 ${payload.notification.sent} 个 Lark 目标。` : "";
      clearFormDirty();
      setInlineStatus($("returnNotice"), `返程登记已完成。已上传 ${payload.photoResult?.uploaded || 0} 张照片。${notificationMessage}${payload.vehicleSync?.message || ""}`, "success");
      if (isMobile) { window.location.href = "?view=apply"; return; }
      await Promise.all([loadTasks(), loadOptions()]);
    } catch (error) { setInlineStatus($("returnNotice"), `返程登记失败：${error.message}`, "error"); }
  }

  async function submitTransfer(event) {
    event.preventDefault();
    if (!state.editingRecordId) return setInlineStatus(transferNotice, "请先选择一条调度任务。", "error");
    const location = transferLocationInput?.value.trim() || "";
    if (!location) return setInlineStatus(transferNotice, "请填写中转地点。", "error");
    setInlineStatus(transferNotice, "正在提交中转登记…");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(state.editingRecordId)}/transfer`, { method: "POST", headers: headers(), body: JSON.stringify({ transferLocation: location }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (isMobile) {
        window.location.href = "?view=apply";
        return;
      }
      clearFormDirty(); resetEditor(); showOverview(); await loadTasks(); setNotice("中转登记已保存，返程起点已贯通。", "success");
    } catch (error) { setInlineStatus(transferNotice, `中转登记失败：${error.message}`, "error"); }
  }

  async function deleteTask(recordId) {
    const task = state.tasks.find((item) => item.recordId === recordId);
    const label = task?.taskNumber || recordId;
     if (!window.confirm(`确定删除调度任务 ${label}？系统会同步删除多维表格记录；若 Base 不允许删除，将改为标记取消以保留审计记录。`)) return;
    setNotice("正在删除调度任务…");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(recordId)}`, { method: "DELETE", headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      state.tasks = state.tasks.filter((item) => item.recordId !== recordId);
      renderStats(); renderRows(); renderHistory(); renderReturnPicker();
       setNotice(payload.softDeleted ? "调度任务已标记为取消，并已同步多维表格。" : "调度任务已删除。", "success");
    } catch (error) { setNotice(`删除调度任务失败：${error.message}`, "error"); }
  }

  function vehicleByRecord(tableId, recordId) {
    return state.vehicles.find((item) => item.tableId === tableId && item.recordId === recordId) || null;
  }

  function ensureVehicleMaintenanceDateField() {
    if ($("vehicleNextMaintenanceDateInput")) return;
    const mileageInput = $("vehicleNextMaintenanceInput");
    if (!mileageInput) return;
    const label = document.createElement("label");
    label.innerHTML = `${t("下次保养日期")}<input id="vehicleNextMaintenanceDateInput" type="date" />`;
    mileageInput.closest("label")?.after(label);
  }

  function vehicleDetailItem(label, value, available = true) {
    const content = available ? (value === null || value === undefined || value === "" ? t("未填写") : String(value)) : t("本表未设置");
    return `<div class="vehicle-detail-item"><span>${escapeHtml(t(label))}</span><strong>${escapeHtml(content)}</strong></div>`;
  }

  function vehicleDetailPhotoItem(label, url, available = true) {
    const content = !available ? t("本表未设置") : url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(t(label))}" width="640" height="360" loading="lazy" decoding="async" />` : t("未上传");
    return `<div class="vehicle-detail-item vehicle-detail-card-photo"><span>${escapeHtml(t(label))}</span><strong>${content}</strong></div>`;
  }

  function vehicleLogBookItem(vehicle) {
    if (!vehicle.logBookField) {
      return `<div class="vehicle-detail-item vehicle-detail-log-book"><span>${escapeHtml(t("车辆大本"))}</span><strong>${escapeHtml(t("未上传车辆大本"))}</strong></div>`;
    }
    const files = vehicle.logBookAttachments || [];
    if (!files.length) {
      return `<div class="vehicle-detail-item vehicle-detail-log-book"><span>${escapeHtml(t("车辆大本"))}</span><strong>${escapeHtml(t("未上传车辆大本"))}</strong></div>`;
    }
    const content = files.map((file) => file.fileToken
      ? `<a class="action-link" href="/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}/log-book/${encodeURIComponent(file.fileToken)}" target="_blank" rel="noopener">${escapeHtml(t("查看大本"))} · ${escapeHtml(file.name)}</a>`
      : file.url
        ? `<a class="action-link" href="${escapeHtml(file.url)}" target="_blank" rel="noopener">${escapeHtml(t("查看大本"))} · ${escapeHtml(file.name)}</a>`
      : `<span class="vehicle-log-book-file">${escapeHtml(file.name)}</span>`).join("<br />");
    return `<div class="vehicle-detail-item vehicle-detail-log-book"><span>${escapeHtml(t("车辆大本"))}</span><strong>${content}</strong></div>`;
  }

  function renderVehicleDetail(vehicle) {
    $("vehicleTrackerInput").value = vehicle.trackerRegistration || "";
    const missing = vehicleMissingFields(vehicle);
    const maintenance = maintenanceReminder(vehicle);
    const inspection = inspectionReminder(vehicle);
    const detailPhotoUrl = vehicle.photoFullUrl || vehicle.photoUrl;
    const photo = detailPhotoUrl ? `<img src="${escapeHtml(detailPhotoUrl)}" alt="${escapeHtml(vehicle.plate)} ${t("车辆照片")}" width="1280" height="720" loading="lazy" decoding="async" />` : `<div class="vehicle-detail-photo-placeholder"><span>${state.language === "en" ? "🚙" : "车"}</span><small>${t("暂无车辆照片")}</small></div>`;
    const status = vehicle.dispatchEligible ? (vehicle.status || t("状态待确认")) : t("不可调度");
    const trackerMatch = state.trackerStatus ? trackerMatchForVehicle(vehicle) : null;
    const completeness = missing.length ? `<p class="vehicle-completeness incomplete">${t("待补全")} ${missing.length} ${state.language === "en" ? "fields: " : "项："}${escapeHtml(missing.map(t).join(state.language === "en" ? ", " : "、"))}</p>` : `<p class="vehicle-completeness complete">${t("车辆资料完整，可用于调度与保养提醒。")}</p>`;
    $("vehicleDetailContent").innerHTML = `<div class="vehicle-detail-hero"><div class="vehicle-detail-photo">${photo}</div><div class="vehicle-detail-summary"><p class="eyebrow">${escapeHtml(vehicle.owner || t("未设置部门 / 门店"))}</p><h3>${escapeHtml(vehicle.modelDescription || t("车型未配置"))}</h3><p class="vehicle-detail-plate">${escapeHtml(vehicle.plate || t("未填写车牌"))}</p><div class="vehicle-detail-badges"><span class="badge ${vehicle.dispatchEligible ? "status-running" : "status-cancelled"}">${escapeHtml(status)}</span>${reminderBadge(maintenance)}${reminderBadge(inspection)}</div>${completeness}</div></div><div class="vehicle-detail-grid"><section class="vehicle-detail-section"><h3>${t("车辆信息")}</h3><div class="vehicle-detail-items">${vehicleDetailItem("车辆品牌", vehicle.brand)}${vehicleDetailItem("车型", vehicle.model)}${vehicleDetailItem("车辆类型", vehicle.vehicleType)}${vehicleDetailItem("车辆状态", vehicle.status)}${vehicleDetailItem("所属门店 / 部门", vehicle.owner)}${vehicleDetailItem("年份", vehicle.year)}</div></section><section class="vehicle-detail-section"><h3>${t("里程与保养")}</h3><div class="vehicle-detail-items">${vehicleDetailItem("当前公里数", vehicle.currentMileageField ? formatMileage(vehicle.mileage) : "", Boolean(vehicle.currentMileageField))}${vehicleDetailItem("下次保养公里数", vehicle.nextMaintenanceMileageField ? formatMileage(vehicle.nextMaintenanceMileage) : "", Boolean(vehicle.nextMaintenanceMileageField))}${vehicleDetailItem("下次保养日期", vehicle.nextMaintenanceDate, Boolean(vehicle.nextMaintenanceDateField))}${vehicleDetailItem("保养状态", maintenance.text)}${vehicleDetailItem("上次保养日期", vehicle.lastServiceDate, Boolean(vehicle.lastServiceDateField))}${vehicleDetailItem("服务提供商", vehicle.serviceProvider, Boolean(vehicle.serviceProviderField))}</div></section><section class="vehicle-detail-section"><h3>${t("大本资料")}</h3><div class="vehicle-detail-items">${vehicleDetailItem("注册地点", vehicle.registeringAuthority, Boolean(vehicle.registeringAuthorityField))}${vehicleDetailItem("注册号", vehicle.registerNumber, Boolean(vehicle.registerNumberField))}${vehicleDetailItem("车辆 ID / VIN", vehicle.vehicleIdentificationNumber, Boolean(vehicle.vehicleIdentificationNumberField))}${vehicleDetailItem("年检到期日期", vehicle.certificateExpiry, Boolean(vehicle.certificateExpiryField))}${vehicleDetailItem("年检状态", inspection.text, Boolean(vehicle.certificateExpiryField))}${vehicleLogBookItem(vehicle)}</div></section><section class="vehicle-detail-section"><h3>${t("保险与配套")}</h3><div class="vehicle-detail-items">${vehicleDetailItem("保单号", vehicle.policyNumber, Boolean(vehicle.policyNumberField))}${vehicleDetailItem("保险信息", vehicle.insurance, Boolean(vehicle.insuranceField))}${vehicleDetailItem("加油油卡号", vehicle.fnbFleetCard, Boolean(vehicle.fnbFleetCardField))}${vehicleDetailItem("备用钥匙", vehicle.spareKey, Boolean(vehicle.spareKeyField))}${vehicleDetailPhotoItem("加油油卡图片", vehicle.fleetCardPhotoUrl, Boolean(vehicle.fleetCardPhotoField))}</div></section></div>`;
    const trackerContent = `<div><p class="eyebrow">TRACKER</p><h3>${t("车辆位置状态")}</h3><p>${escapeHtml(t("位置、里程与数据时间在独立菜单中显示。"))}</p><div class="vehicle-detail-badges">${state.trackerStatus ? trackerBadge(trackerMatch) : ""}</div></div>`;
    $("vehicleDetailContent").insertAdjacentHTML("beforeend", `<section class="vehicle-tracker-panel">${trackerContent}<button class="button button-primary" type="button" data-tracker-table="${escapeHtml(vehicle.tableId)}" data-tracker-record="${escapeHtml(vehicle.recordId)}">${t("查看位置状态")}</button></section>`);
    $("vehicleMaintenancePanel").hidden = !userCan("manage_maintenance");
    renderMaintenanceHistory();
  }

  function renderMaintenanceHistory() {
    const container = $("maintenanceHistory");
    const summary = $("maintenanceHistorySummary");
    if (!container || !summary) return;
    const records = state.maintenanceRecords || [];
    summary.textContent = `${records.length} ${t("条记录")}`;
    if (!records.length) { container.innerHTML = `<div class="empty-card">${t("暂无保养记录。")}</div>`; return; }
    container.innerHTML = records.map((record) => {
      const documentLink = record.warrantyDocument ? `<a class="action-link" href="/api/vehicles/${encodeURIComponent(record.tableId)}/${encodeURIComponent(record.recordId)}/maintenance/${encodeURIComponent(record.id)}/warranty" target="_blank" rel="noopener">${t("下载")} · ${escapeHtml(record.warrantyDocument.fileName)}</a>` : `<span class="maintenance-document-empty">${t("未上传")}</span>`;
      return `<article class="maintenance-record"><div class="maintenance-record-top"><strong>${escapeHtml(record.serviceDate || t("未填写"))}</strong><span>${escapeHtml(record.plate || "")}</span></div><div class="maintenance-record-meta"><span>${t("保养公里数")}：${escapeHtml(formatMileage(record.mileage))}</span><span>${t("下次保养日期")}：${escapeHtml(record.nextMaintenanceDate || t("未填写"))}</span><span>${t("下次保养公里数")}：${escapeHtml(formatMileage(record.nextMaintenanceMileage))}</span><span>${t("服务提供商")}：${escapeHtml(record.provider || t("未填写"))}</span><span>${t("确认人")}：${escapeHtml(record.confirmedBy || t("未填写"))}</span></div>${record.notes ? `<p>${escapeHtml(record.notes)}</p>` : ""}<div class="maintenance-record-footer"><span>${t("已回写字段")}：${escapeHtml((record.updatedBaseFields || []).join(", ") || t("未填写"))}</span>${documentLink}</div></article>`;
    }).join("");
  }

  async function loadMaintenance(vehicle) {
    const key = `${vehicle.tableId}:${vehicle.recordId}`;
    state.maintenanceVehicleKey = key;
    state.maintenanceRecords = [];
    renderMaintenanceHistory();
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}/maintenance`, { headers: headers() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (state.maintenanceVehicleKey !== key) return;
      state.maintenanceRecords = payload.records || [];
      renderMaintenanceHistory();
    } catch (error) {
      if (state.maintenanceVehicleKey !== key) return;
      $("maintenanceHistory").innerHTML = `<div class="empty-card">${escapeHtml(`${t("保养记录读取失败：")}${error.message}`)}</div>`;
      $("maintenanceHistorySummary").textContent = "";
    }
  }

  function setVehicleRoute(routeView, tableId, recordId, updateHistory) {
    const route = `?view=${routeView}&table=${encodeURIComponent(tableId)}&record=${encodeURIComponent(recordId)}`;
    history[updateHistory ? "pushState" : "replaceState"](null, "", route);
  }

  function openVehicleDetail(tableId, recordId, updateHistory = true) {
    const vehicle = vehicleByRecord(tableId, recordId);
    if (!vehicle) return setNotice("未找到车辆档案，请刷新后重试。", "error");
    resetPageScroll();
    state.editingVehicle = vehicle;
    state.maintenanceRecords = [];
    maintenanceForm?.reset();
    $("maintenanceDateInput").value = new Date().toISOString().slice(0, 10);
    $("maintenanceMileageInput").value = vehicle.mileage ?? "";
    $("maintenanceNextDateInput").value = vehicle.nextMaintenanceDate || "";
    $("maintenanceNextMileageInput").value = vehicle.nextMaintenanceMileage ?? "";
    document.body.classList.remove("editor-mode");
    renderVehicleDetail(vehicle); showOnly("vehicleDetail");
    setVehicleRoute("vehicle", tableId, recordId, updateHistory);
    if (userCan("manage_maintenance")) void loadMaintenance(vehicle);
  }

  function openVehicleEditor(tableId, recordId, updateHistory = true) {
    ensureVehicleMaintenanceDateField();
    const vehicle = vehicleByRecord(tableId, recordId);
    if (!vehicle) return setNotice("未找到车辆档案，请刷新后重试。", "error");
    resetPageScroll();
    state.creatingVehicle = false; state.editingVehicle = vehicle; state.vehiclePhotoDataUrl = ""; state.vehiclePhotoFullDataUrl = ""; state.vehiclePhotoThumbnailDataUrl = ""; state.logBookDocument = null; state.fleetCardPhotoDataUrl = ""; vehicleForm.reset(); showOnly("vehicleEditor");
    $("vehicleTableField").hidden = true;
    $("vehicleStatusInput").disabled = false;
    $("vehicleSaveButton").textContent = t("保存车辆资料");
    $("markSoldButton").hidden = !userCan("manage_vehicles") || isSoldVehicle(vehicle);
    $("deleteVehicleButton").hidden = !userCan("manage_vehicles");
    $("vehicleFormTitle").textContent = `${t("编辑车辆资料")} · ${vehicle.plate}`; $("vehiclePlateInput").value = vehicle.plate; $("vehicleBrandInput").value = vehicle.brand || ""; $("vehicleModelInput").value = vehicle.model || ""; $("vehicleTypeInput").value = vehicle.vehicleType || ""; $("vehicleStatusInput").value = vehicle.status || ""; $("vehicleOwnerInput").value = vehicle.owner || ""; $("vehicleYearInput").value = vehicle.year || "";
    $("vehicleRegisteringAuthorityInput").value = vehicle.registeringAuthority || ""; $("vehicleLastServiceDateInput").value = dateInputValue(vehicle.lastServiceDate); $("vehicleServiceProviderInput").value = vehicle.serviceProvider || ""; $("vehicleSpareKeyInput").value = vehicle.spareKey || ""; $("vehicleRegisterNumberInput").value = vehicle.registerNumber || ""; $("vehicleIdentificationNumberInput").value = vehicle.vehicleIdentificationNumber || ""; $("vehicleCertificateExpiryInput").value = dateInputValue(vehicle.certificateExpiry); $("vehiclePolicyNumberInput").value = vehicle.policyNumber || ""; $("vehicleInsuranceInput").value = vehicle.insurance || ""; $("vehicleFnbFleetCardInput").value = vehicle.fnbFleetCard || ""; $("vehicleFnbFleetCardInput").disabled = !vehicle.fnbFleetCardField;
    $("vehicleMileageInput").value = vehicle.mileage ?? ""; $("vehicleMileageInput").disabled = !vehicle.currentMileageField;
    $("vehicleNextMaintenanceInput").value = vehicle.nextMaintenanceMileage ?? ""; $("vehicleNextMaintenanceInput").disabled = !vehicle.nextMaintenanceMileageField;
    $("vehicleNextMaintenanceDateInput").value = vehicle.nextMaintenanceDate || ""; $("vehicleNextMaintenanceDateInput").disabled = !vehicle.nextMaintenanceDateField;
    const missing = vehicleMissingFields(vehicle);
    setInlineStatus($("vehicleDataHint"), missing.length ? `${t("待补全")}：${missing.map(t).join(state.language === "en" ? ", " : "、")}。` : t("车辆资料已完整。"), missing.length ? "error" : "success");
    $("vehicleNotice").textContent = "";
    const existingPhotoUrl = vehicle.photoFullUrl || vehicle.photoUrl;
    $("vehiclePhotoPreview").innerHTML = existingPhotoUrl ? `<img src="${escapeHtml(existingPhotoUrl)}" alt="${escapeHtml(vehicle.plate)} ${t("车辆照片")}" width="1280" height="720" loading="lazy" decoding="async" />` : t("暂无车辆照片");
    $("vehicleLogBookInput").disabled = !vehicle.logBookField;
    $("vehicleLogBookPreview").innerHTML = vehicle.logBookField ? (vehicle.logBookAttachments?.length ? vehicle.logBookAttachments.map((file) => escapeHtml(file.name)).join("<br />") : t("未上传车辆大本")) : `${t("本表未设置")} ${t("车辆大本")}`;
    $("fleetCardPhotoInput").disabled = !vehicle.fleetCardPhotoField;
    $("fleetCardPhotoPreview").innerHTML = vehicle.fleetCardPhotoUrl ? `<img src="${escapeHtml(vehicle.fleetCardPhotoUrl)}" alt="${escapeHtml(vehicle.plate)} ${t("加油油卡图片")}" width="640" height="480" loading="lazy" decoding="async" />` : vehicle.fleetCardPhotoField ? t("暂无加油油卡图片") : `${t("本表未设置")} ${t("加油油卡图片")}`;
    renderVehicleEditorOptions();
    state.vehicleEditorBaseline = vehicleEditorFingerprint();
    clearFormDirty();
    setVehicleRoute("vehicle-edit", tableId, recordId, updateHistory);
  }

  function vehicleTableOptions() {
    const tables = new Map();
    state.vehicles.forEach((vehicle) => {
      if (!tables.has(vehicle.tableId)) tables.set(vehicle.tableId, vehicle.tableName || vehicle.tableId);
    });
    return [...tables.entries()].map(([tableId, tableName]) => ({ tableId, tableName }));
  }

  function openSoldVehicleCreator() {
    ensureVehicleMaintenanceDateField();
    const tables = vehicleTableOptions();
    if (!tables.length) return setNotice("未读取到车辆档案表，暂时无法添加已售车辆。", "error");
    state.creatingVehicle = true; state.editingVehicle = null; state.vehiclePhotoDataUrl = ""; state.vehiclePhotoFullDataUrl = ""; state.vehiclePhotoThumbnailDataUrl = ""; state.logBookDocument = null; state.fleetCardPhotoDataUrl = "";
    vehicleForm.reset(); showOnly("vehicleEditor");
    $("vehicleTableField").hidden = false;
    $("vehicleTableInput").innerHTML = tables.map((table) => `<option value="${escapeHtml(table.tableId)}">${escapeHtml(table.tableName)}</option>`).join("");
    $("vehicleFormTitle").textContent = t("新增已售车辆");
    $("vehicleStatusInput").value = "Sold"; $("vehicleStatusInput").disabled = true;
    $("vehicleMileageInput").disabled = false; $("vehicleNextMaintenanceInput").disabled = false; $("vehicleNextMaintenanceDateInput").disabled = false; $("vehicleLogBookInput").disabled = false; $("fleetCardPhotoInput").disabled = false;
    $("vehiclePhotoPreview").textContent = t("暂无车辆照片"); $("vehicleLogBookPreview").textContent = t("未上传车辆大本"); $("fleetCardPhotoPreview").textContent = t("暂无加油油卡图片");
    $("vehicleSaveButton").textContent = t("保存已售车辆");
    $("markSoldButton").hidden = true;
    $("deleteVehicleButton").hidden = true;
    setInlineStatus($("vehicleDataHint"), t("已售车辆会标记为不可调度，仅在已售车辆区域显示。"), "success");
    $("vehicleNotice").textContent = "";
    renderVehicleEditorOptions();
    state.vehicleEditorBaseline = vehicleEditorFingerprint();
    clearFormDirty();
    history.pushState(null, "", "?view=vehicle-edit&create=sold");
  }

  function localizeVehicleEditorChrome() {
    const vehicle = state.editingVehicle;
    if (!vehicle) return;
    $("vehicleFormTitle").textContent = `${t("编辑车辆资料")} · ${vehicle.plate}`;
    const missing = vehicleMissingFields(vehicle);
    setInlineStatus($("vehicleDataHint"), missing.length ? `${t("待补全")}：${missing.map(t).join(state.language === "en" ? ", " : "、")}。` : t("车辆资料已完整。"), missing.length ? "error" : "success");
  }

  async function processVehiclePhoto(file) {
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("车辆照片原文件不能超过 25 MB");
      const variants = await prepareVehicleProfilePhoto(file);
      state.vehiclePhotoFullDataUrl = variants.full;
      state.vehiclePhotoThumbnailDataUrl = variants.thumbnail;
      state.vehiclePhotoDataUrl = variants.thumbnail;
      $("vehiclePhotoPreview").innerHTML = `<img src="${escapeHtml(variants.full)}" alt="${t("新车辆照片预览")}" width="1280" height="720" /><small>${t("建议上传清晰原图；列表使用轻量缩略图，详情页再加载高清图。")}</small>`;
    } catch (error) { setInlineStatus($("vehicleNotice"), `处理车辆照片失败：${error.message}`, "error"); }
  }

  async function processFleetCardPhoto(file) {
    try {
      state.fleetCardPhotoDataUrl = await preparePhoto(file, [t("加油油卡图片"), formatDate(new Date().toISOString())]);
      $("fleetCardPhotoPreview").innerHTML = `<img src="${escapeHtml(state.fleetCardPhotoDataUrl)}" alt="${t("新加油油卡图片预览")}" width="640" height="480" />`;
    } catch (error) { setInlineStatus($("vehicleNotice"), `处理加油油卡图片失败：${error.message}`, "error"); }
  }

  async function processVehicleLogBook(file) {
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error("车辆大本文件大小不能超过 12 MB");
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 PDF、JPG、PNG 或 WebP 格式的车辆大本");
      state.logBookDocument = { fileName: file.name, dataUrl: await fileToDataUrl(file) };
      $("vehicleLogBookPreview").textContent = file.name;
    } catch (error) { setInlineStatus($("vehicleNotice"), `处理车辆大本失败：${error.message}`, "error"); }
  }

  async function saveVehicle(event) {
    event.preventDefault(); if (!state.editingVehicle && !state.creatingVehicle) return;
    const vehicle = state.editingVehicle;
    if (!state.creatingVehicle && vehicleEditorFingerprint() === state.vehicleEditorBaseline) {
      setInlineStatus($("vehicleNotice"), "未检测到车辆资料变更，无需保存。", "success");
      return;
    }
    const payload = { plate: $("vehiclePlateInput").value, brand: $("vehicleBrandInput").value, model: $("vehicleModelInput").value, vehicleType: $("vehicleTypeInput").value, status: $("vehicleStatusInput").value, owner: $("vehicleOwnerInput").value, year: $("vehicleYearInput").value, registeringAuthority: $("vehicleRegisteringAuthorityInput").value, lastServiceDate: $("vehicleLastServiceDateInput").value, nextMaintenanceDate: $("vehicleNextMaintenanceDateInput").value, serviceProvider: $("vehicleServiceProviderInput").value, spareKey: $("vehicleSpareKeyInput").value, registerNumber: $("vehicleRegisterNumberInput").value, vehicleIdentificationNumber: $("vehicleIdentificationNumberInput").value, certificateExpiry: $("vehicleCertificateExpiryInput").value, policyNumber: $("vehiclePolicyNumberInput").value, insurance: $("vehicleInsuranceInput").value, fnbFleetCard: $("vehicleFnbFleetCardInput").value, mileage: $("vehicleMileageInput").value, nextMaintenanceMileage: $("vehicleNextMaintenanceInput").value, photoFullDataUrl: state.vehiclePhotoFullDataUrl || undefined, photoThumbnailDataUrl: state.vehiclePhotoThumbnailDataUrl || undefined, photoFileName: $("vehiclePhotoInput").files?.[0]?.name || undefined, logBookDocument: state.logBookDocument || undefined, fleetCardPhotoDataUrl: state.fleetCardPhotoDataUrl || undefined };
    payload.trackerRegistration = $("vehicleTrackerInput").value;
    if (state.creatingVehicle) payload.tableId = $("vehicleTableInput").value;
    setInlineStatus($("vehicleNotice"), "正在保存车辆资料…");
    try {
      const endpoint = state.creatingVehicle ? "/api/vehicles" : `/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}`;
      const response = await fetch(endpoint, { method: state.creatingVehicle ? "POST" : "PATCH", headers: headers(), body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      const wasCreating = state.creatingVehicle;
      state.vehicleEditorBaseline = vehicleEditorFingerprint();
      clearFormDirty(); setInlineStatus($("vehicleNotice"), wasCreating ? "已售车辆已添加。" : "车辆资料已更新。", "success"); await loadOptions();
      const updatedVehicle = vehicleByRecord(result.vehicle.tableId, result.vehicle.recordId) || result.vehicle || vehicle;
      state.editingVehicle = updatedVehicle;
      state.creatingVehicle = false;
      setTimeout(() => openVehicleDetail(updatedVehicle.tableId, updatedVehicle.recordId), 350);
    } catch (error) { setInlineStatus($("vehicleNotice"), `保存车辆资料失败：${error.message}`, "error"); }
  }

  async function markVehicleSold() {
    const vehicle = state.editingVehicle;
    if (!vehicle) return;
    if (!window.confirm(t("确定将这台车辆标记为已售吗？标记后车辆将从可调度车辆中移除。"))) return;
    setInlineStatus($("vehicleNotice"), "正在标记车辆为已售…");
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}/sold`, { method: "PATCH", headers: headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      const index = state.vehicles.findIndex((item) => item.tableId === vehicle.tableId && item.recordId === vehicle.recordId);
      if (index >= 0) state.vehicles[index] = result.vehicle;
      state.editingVehicle = result.vehicle;
      $("markSoldButton").hidden = true;
      setInlineStatus($("vehicleNotice"), "车辆已标记为已售。", "success");
      renderOptions(); renderVehicles();
      setTimeout(() => openVehicleDetail(result.vehicle.tableId, result.vehicle.recordId), 350);
    } catch (error) { setInlineStatus($("vehicleNotice"), `${t("标记已售失败：")}${error.message}`, "error"); }
  }

  async function deleteVehicle() {
    const vehicle = state.editingVehicle;
    if (!vehicle) return;
    const notice = !$("vehicleEditorView").hidden ? $("vehicleNotice") : $("notice");
    const message = state.language === "en"
      ? `Permanently delete vehicle ${vehicle.plate || "this record"}? Its vehicle record, local profile photos and maintenance attachments will be deleted. Dispatch history remains available.`
      : `确定直接删除车辆“${vehicle.plate || "当前车辆"}”吗？车辆档案、本机车辆照片和保养附件都会删除；调度历史会保留。`;
    if (!window.confirm(message)) return;
    setInlineStatus(notice, t("正在删除车辆档案…"));
    try {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}`, { method: "DELETE", headers: headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.vehicles = state.vehicles.filter((item) => item.tableId !== vehicle.tableId || item.recordId !== vehicle.recordId);
      state.editingVehicle = null;
      state.maintenanceRecords = [];
      await loadOptions();
      showOverview();
      setNotice(t("车辆档案已删除。"), "success");
    } catch (error) {
      setInlineStatus(notice, `${t("删除车辆档案失败：")}${error.message}`, "error");
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("无法读取文件"));
      reader.readAsDataURL(file);
    });
  }

  async function saveMaintenance(event) {
    event.preventDefault();
    const vehicle = state.editingVehicle;
    if (!vehicle) return;
    const file = $("maintenanceWarrantyInput").files?.[0];
    if (file && file.size > 12 * 1024 * 1024) { setInlineStatus($("maintenanceNotice"), "文件大小不能超过 12 MB", "error"); return; }
    if (file && !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) { setInlineStatus($("maintenanceNotice"), "请选择有效的保修单文件", "error"); return; }
    setInlineStatus($("maintenanceNotice"), "正在保存保养记录…");
    try {
      const warrantyDocument = file ? { fileName: file.name, dataUrl: await fileToDataUrl(file) } : undefined;
      const payload = { serviceDate: $("maintenanceDateInput").value, mileage: $("maintenanceMileageInput").value, nextMaintenanceDate: $("maintenanceNextDateInput").value, nextMaintenanceMileage: $("maintenanceNextMileageInput").value, provider: $("maintenanceProviderInput").value, notes: $("maintenanceNotesInput").value, warrantyDocument };
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicle.tableId)}/${encodeURIComponent(vehicle.recordId)}/maintenance`, { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (result.vehicle) {
        const index = state.vehicles.findIndex((item) => item.tableId === vehicle.tableId && item.recordId === vehicle.recordId);
        if (index >= 0) state.vehicles[index] = result.vehicle;
        state.editingVehicle = result.vehicle;
      }
      state.maintenanceRecords = [result.record, ...(state.maintenanceRecords || [])];
      maintenanceForm.reset();
      $("maintenanceDateInput").value = new Date().toISOString().slice(0, 10);
      $("maintenanceNextDateInput").value = result.vehicle?.nextMaintenanceDate || "";
      $("maintenanceNextMileageInput").value = result.vehicle?.nextMaintenanceMileage ?? "";
      renderMaintenanceHistory();
      renderVehicleDetail(state.editingVehicle);
      clearFormDirty(); setInlineStatus($("maintenanceNotice"), "保养已确认。", "success");
    } catch (error) { setInlineStatus($("maintenanceNotice"), `保养确认失败：${error.message}`, "error"); }
  }

  $("syncButton").addEventListener("click", syncNow);
  $("logoutButton").addEventListener("click", logout);
  $("mobileLogoutButton")?.addEventListener("click", logout);
  if (isMobile) {
    document.querySelectorAll("a.mobile-action").forEach((link) => link.addEventListener("click", (event) => {
      const target = new URL(link.href, window.location.href).searchParams.get("view");
      if (["departure", "transfer", "return"].includes(target)) {
        event.preventDefault();
        navigateMobileFlow(target);
      }
    }));
    document.querySelectorAll('a[href="?view=apply"]').forEach((link) => link.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState(null, "", "?view=apply");
      showMobileHome();
    }));
  }
  $("newTaskButton").addEventListener("click", () => openEditor());
  $("addSoldVehicleButton").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openSoldVehicleCreator(); });
  $("backToOverviewButton").addEventListener("click", backFromTaskEditor);
  $("backFromVehicleButton").addEventListener("click", () => { if (state.editingVehicle) openVehicleDetail(state.editingVehicle.tableId, state.editingVehicle.recordId); else showOverview(); });
  $("backFromVehicleDetailButton").addEventListener("click", showOverview);
  $("saveNotificationSettingsButton").addEventListener("click", saveNotificationSettings);
  $("vehicleOptionsLink")?.addEventListener("click", (event) => { event.preventDefault(); openVehicleOptions(); });
  $("vehicleOptionsOverviewLink")?.addEventListener("click", (event) => { event.preventDefault(); openVehicleOptions(); });
  $("vehicleOptionsContent")?.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-option-remove]");
    if (remove) {
      const chip = remove.closest("[data-option-chip]");
      const container = chip?.closest("[data-option-chips]");
      const remaining = container?.querySelectorAll("[data-option-chip]").length || 0;
      const option = chip?.dataset.optionChip || "";
      if (remaining <= 1) { setInlineStatus($("vehicleOptionsNotice"), t("至少保留一个选项。"), "error"); return; }
      const message = state.language === "en"
        ? `Delete option "${option}" now? This change will be synced to Lark immediately.`
        : `确定直接删除选项“${option}”吗？此操作会立即同步到 Lark 多维表格。`;
      if (!window.confirm(message)) return;
      chip?.remove();
      const [tableId, fieldId] = (container?.dataset.optionChips || "").split(":");
      if (tableId && fieldId) void saveVehicleOption(tableId, fieldId);
      return;
    }
    const add = event.target.closest("button[data-option-add]");
    if (add) {
      const key = `${add.dataset.tableId}:${add.dataset.fieldId}`;
      const input = document.querySelector(`input[data-option-input="${CSS.escape(key)}"]`);
      const value = input?.value.trim() || "";
      const chips = [...document.querySelectorAll(`[data-option-chips="${CSS.escape(key)}"] [data-option-chip]`)].map((chip) => chip.querySelector("[data-option-edit]")?.value || chip.dataset.optionChip || "");
      if (!value) return;
      if (chips.some((chip) => chip.trim().toLowerCase() === value.toLowerCase())) { setInlineStatus($("vehicleOptionsNotice"), t("选项已存在。"), "error"); return; }
      const container = document.querySelector(`[data-option-chips="${CSS.escape(key)}"]`);
      container?.insertAdjacentHTML("beforeend", vehicleOptionChip(value));
      if (input) input.value = "";
      return;
    }
    const save = event.target.closest("button[data-option-save]");
    if (save) void saveVehicleOption(save.dataset.tableId, save.dataset.fieldId);
  });
  $("editVehicleButton").addEventListener("click", () => { if (state.editingVehicle) openVehicleEditor(state.editingVehicle.tableId, state.editingVehicle.recordId); });
  $("markSoldButton").addEventListener("click", markVehicleSold);
  $("deleteVehicleButton").addEventListener("click", deleteVehicle);
  $("deleteVehicleDetailButton").addEventListener("click", deleteVehicle);
  $("cancelEditButton").addEventListener("click", () => { if (state.editingVehicle) openVehicleDetail(state.editingVehicle.tableId, state.editingVehicle.recordId); else showOverview(); });
  $("returnSubmitButton").addEventListener("click", submitReturn);
  $("vehicleSelect").addEventListener("change", updateVehicleReadout);
  $("vehicleSelect").addEventListener("focus", () => { if (!state.vehicles.length && !state.optionsLoading) void loadOptions(); });
  $("bookingVehicleSelect").addEventListener("change", updateBookingReadout);
  requesterInput?.addEventListener("input", () => matchRequesterInput("requesterInput", "requesterSelect", "requesterMatchStatus"));
  bookingRequesterInput?.addEventListener("input", () => matchRequesterInput("bookingRequesterInput", "bookingRequesterSelect", "bookingRequesterMatchStatus"));
  $("requesterSelect").addEventListener("change", () => { syncRequesterInput("requesterSelect", "requesterInput"); updateRequesterMatchStatus("requesterInput", "requesterSelect", "requesterMatchStatus"); });
  $("bookingRequesterSelect").addEventListener("change", () => { syncRequesterInput("bookingRequesterSelect", "bookingRequesterInput"); updateRequesterMatchStatus("bookingRequesterInput", "bookingRequesterSelect", "bookingRequesterMatchStatus"); });
  vehicleDepartmentQuickSelect?.addEventListener("change", () => { vehicleDepartmentQuickSelect.dataset.departmentTouched = "true"; renderDispatchVehicleOptions(); updateVehicleReadout(); });
  bookingVehicleDepartmentQuickSelect?.addEventListener("change", () => { bookingVehicleDepartmentQuickSelect.dataset.departmentTouched = "true"; renderDispatchVehicleOptions(); updateBookingReadout(); });
  [["originQuickSelect", "originInput"], ["destinationQuickSelect", "destinationInput"]].forEach(([selectId, inputId]) => $(selectId).addEventListener("change", () => { if ($(selectId).value) $(inputId).value = $(selectId).value; }));
  [["bookingOriginQuickSelect", "bookingOriginInput"], ["bookingDestinationQuickSelect", "bookingDestinationInput"]].forEach(([selectId, inputId]) => $(selectId).addEventListener("change", () => { if ($(selectId).value) $(inputId).value = $(selectId).value; }));
  [["returnOriginQuickSelect", "returnOriginInput"], ["returnDestinationQuickSelect", "returnDestinationInput"], ["transferLocationQuickSelect", "transferLocationInput"]].forEach(([selectId, inputId]) => $(selectId)?.addEventListener("change", () => { if ($(selectId).value) $(inputId).value = $(selectId).value; }));
  $("vehiclePhotoInput").addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) processVehiclePhoto(file); });
  $("vehicleLogBookInput").addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) processVehicleLogBook(file); });
  $("fleetCardPhotoInput").addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) processFleetCardPhoto(file); });
  document.querySelectorAll("select[data-vehicle-choice-for]").forEach((select) => select.addEventListener("change", () => {
    const input = $(select.dataset.vehicleChoiceFor);
    if (input && select.value) input.value = select.value;
    select.value = "";
  }));
  vehicleForm.addEventListener("submit", saveVehicle);
  maintenanceForm?.addEventListener("submit", saveMaintenance);
  bookingForm.addEventListener("submit", saveBooking);
  $("languageToggle").addEventListener("click", () => { state.language = state.language === "zh" ? "en" : "zh"; sessionStorage.setItem("dispatch_language_override_v2", state.language); applyLanguage(); window.dispatchEvent(new Event("dispatch:language")); });
  searchInput?.addEventListener("input", () => { updateQueryState({ taskSearch: searchInput.value.trim() }); renderRows(); });
  statusFilter?.addEventListener("change", () => { state.quickStatusFilter = ""; updateQueryState({ taskStatus: statusFilter.value }); renderRows(); });
  vehicleDepartmentFilter?.addEventListener("change", renderVehicles);
  [[historySearchInput, "historySearch"], [historyVehicleFilter, "historyVehicle"], [historyRequesterFilter, "historyRequester"], [historyStatusFilter, "historyStatus"], [historyDateFrom, "historyDateFrom"], [historyDateTo, "historyDateTo"]].forEach(([input, key]) => input?.addEventListener(input === historySearchInput ? "input" : "change", () => { updateQueryState({ [key]: input.value.trim() }); renderHistory(); }));
  form.addEventListener("submit", saveTask);
  transferForm?.addEventListener("submit", submitTransfer);
  document.querySelectorAll("input[data-photo-phase]").forEach((input) => input.addEventListener("change", () => { const file = input.files?.[0]; if (file) processPhoto(input.dataset.photoPhase, input.dataset.photoPosition, file); }));
  rows?.addEventListener("click", (event) => { const edit = event.target.closest("button[data-record-id]"); const returnButton = event.target.closest("button[data-return-id]"); const deleteButton = event.target.closest("button[data-delete-id]"); if (edit) { const task = state.tasks.find((item) => item.recordId === edit.dataset.recordId); if (task) openEditor(task); } else if (returnButton) { const task = state.tasks.find((item) => item.recordId === returnButton.dataset.returnId); if (task) openReturn(task); } else if (deleteButton) deleteTask(deleteButton.dataset.deleteId); else { const row = event.target.closest("tr[data-task-record]"); if (row?.dataset.taskRecord) selectTaskInWorkspace(row.dataset.taskRecord, "table"); } });
  rows?.addEventListener("keydown", (event) => { if (event.key !== "Enter" && event.key !== " ") return; const row = event.target.closest("tr[data-task-record]"); if (!row?.dataset.taskRecord) return; event.preventDefault(); selectTaskInWorkspace(row.dataset.taskRecord, "table"); });
  $("taskInspectorActions")?.addEventListener("click", (event) => { const edit = event.target.closest("button[data-inspector-edit]"); const returnButton = event.target.closest("button[data-inspector-return]"); const deleteButton = event.target.closest("button[data-inspector-delete]"); if (edit) { const task = state.tasks.find((item) => item.recordId === edit.dataset.inspectorEdit); if (task) openEditor(task); } else if (returnButton) { const task = state.tasks.find((item) => item.recordId === returnButton.dataset.inspectorReturn); if (task) openReturn(task); } else if (deleteButton?.dataset.inspectorDelete) deleteTask(deleteButton.dataset.inspectorDelete); });
  $("returnTaskList").addEventListener("click", (event) => { const button = event.target.closest("button[data-return-id]"); if (!button) return; const task = state.tasks.find((item) => item.recordId === button.dataset.returnId); if (task) openReturn(task); });
  $("transferTaskList")?.addEventListener("click", (event) => { const button = event.target.closest("button[data-transfer-id]"); if (!button) return; const task = state.tasks.find((item) => item.recordId === button.dataset.transferId); if (task) openTransfer(task); });
  historyRows.addEventListener("click", (event) => { const button = event.target.closest("button[data-history-record]"); const deleteButton = event.target.closest("button[data-delete-id]"); if (button) { const task = state.tasks.find((item) => item.recordId === button.dataset.historyRecord); if (task) openEditor(task); } else if (deleteButton) deleteTask(deleteButton.dataset.deleteId); });
  taskTimeline?.addEventListener("click", (event) => { const button = event.target.closest("button[data-timeline-record]"); if (!button?.dataset.timelineRecord) return; selectTaskInWorkspace(button.dataset.timelineRecord, "timeline"); });
  document.querySelectorAll("button[data-timeline-scale]").forEach((button) => button.addEventListener("click", () => { state.timelineScale = button.dataset.timelineScale || "day"; updateTimelineScaleControls(); updateQueryState({ timelineScale: state.timelineScale }); renderTimeline({ feedback: true }); }));
  [$("timelineDateFrom"), $("timelineDateTo")].forEach((input) => input?.addEventListener("change", () => { updateQueryState({ [input.id]: input.value }); renderTimeline({ feedback: true }); }));
  $("clearTimelineDateFilter")?.addEventListener("click", () => { $("timelineDateFrom").value = ""; $("timelineDateTo").value = ""; updateQueryState({ timelineDateFrom: "", timelineDateTo: "" }); renderTimeline({ feedback: true }); });
  bookingRows?.addEventListener("click", (event) => {
    const approve = event.target.closest("button[data-booking-approve]");
    const reject = event.target.closest("button[data-booking-reject]");
    if (approve?.dataset.bookingApprove) void decideBooking(approve.dataset.bookingApprove, "approve");
    else if (reject?.dataset.bookingReject) void decideBooking(reject.dataset.bookingReject, "reject");
  });
  document.querySelectorAll(".stat-card").forEach((card) => { const activate = () => { const target = card.dataset.status || ""; state.quickStatusFilter = target === "待调度" ? "__pending__" : target; if (statusFilter) statusFilter.value = target === "待调度" ? "" : target; updateQueryState({ taskStatus: statusFilter?.value || "" }); renderRows(); document.querySelector("#taskRows")?.scrollIntoView({ behavior: contextualScrollBehavior(), block: "start" }); }; card.addEventListener("click", activate); card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } }); });
  document.querySelectorAll("#taskForm, #bookingForm, #transferForm, #vehicleForm, #maintenanceForm, #returnSection").forEach((container) => {
    container.addEventListener("input", markFormDirty);
    container.addEventListener("change", markFormDirty);
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = "";
  });
  notificationSettingsContent?.addEventListener("click", (event) => {
    const remove = event.target.closest("button[data-notify-remove]");
    if (remove) { removeNotificationTarget(remove.dataset.notifyDepartment, remove.dataset.notifyStage, remove.dataset.notifyType, remove.dataset.notifyId); return; }
    const addUser = event.target.closest("button[data-notify-add-user]");
    if (addUser) {
      const select = notificationSettingsContent.querySelector(`select[data-notify-user="${CSS.escape(addUser.dataset.notifyDepartment)}"][data-notify-stage="${CSS.escape(addUser.dataset.notifyStage)}"]`);
      const user = state.users.find((item) => item.id === select?.value);
      if (user) addNotificationTarget(addUser.dataset.notifyDepartment, addUser.dataset.notifyStage, { type: "user", id: user.id, label: user.name });
      return;
    }
    const addChat = event.target.closest("button[data-notify-add-chat]");
    if (addChat) {
      const input = notificationSettingsContent.querySelector(`input[data-notify-chat="${CSS.escape(addChat.dataset.notifyDepartment)}"][data-notify-stage="${CSS.escape(addChat.dataset.notifyStage)}"]`);
      const id = input?.value.trim() || "";
      if (!/^oc_[A-Za-z0-9_-]+$/.test(id)) { setInlineStatus($("notificationSettingsNotice"), "群聊 ID 必须以 oc_ 开头。", "error"); return; }
      addNotificationTarget(addChat.dataset.notifyDepartment, addChat.dataset.notifyStage, { type: "chat", id, label: id });
      if (input) input.value = "";
    }
  });
  notificationSettingsContent?.addEventListener("change", (event) => {
    const field = event.target.closest("[data-reminder-field]");
    if (!field) return;
    const [kind, name] = String(field.dataset.reminderField || "").split(".");
    if (!state.notificationReminders[kind]) return;
    if (name === "enabled") state.notificationReminders[kind].enabled = Boolean(field.checked);
    else {
      const value = Number(field.value);
      if (!Number.isFinite(value)) return;
      const limits = { daysBefore: [0, 3650], mileageBefore: [0, 1000000], frequencyHours: [1, 8760], maxSends: [1, 100] }[name];
      if (!limits) return;
      state.notificationReminders[kind][name] = Math.min(limits[1], Math.max(limits[0], Math.round(value)));
      field.value = state.notificationReminders[kind][name];
    }
  });
  function handleVehicleCardClick(event) {
    const dispatch = event.target.closest("button[data-new-plate]");
    const edit = event.target.closest("button[data-vehicle-record]");
    const tracker = event.target.closest("button[data-tracker-record]");
    if (tracker) openTrackerVehicle(tracker.dataset.trackerTable, tracker.dataset.trackerRecord);
    else if (dispatch) openEditor(null, dispatch.dataset.newPlate);
    else if (edit) openVehicleDetail(edit.dataset.vehicleTable, edit.dataset.vehicleRecord);
  }
  $("vehicleCards").addEventListener("click", handleVehicleCardClick);
  $("soldVehicleCards")?.addEventListener("click", handleVehicleCardClick);
  $("vehicleDetailContent")?.addEventListener("click", handleVehicleCardClick);
  $("trackerHistoryLink")?.addEventListener("click", (event) => { event.preventDefault(); openTrackerHistory(); });
  trackerHistoryVehicleButton?.addEventListener("click", () => { const vehicleKey = state.trackerVehicleKey; openTrackerHistory(vehicleKey); });
  trackerHistoryForm?.addEventListener("submit", (event) => { event.preventDefault(); void loadTrackerHistory(true); });
  $("trackerHistoryReset")?.addEventListener("click", () => {
    trackerHistoryVehicle.value = "";
    trackerHistoryQuery.value = "";
    trackerHistoryStatus.value = "";
    trackerHistoryOrder.value = "desc";
    trackerHistoryLimit.value = "100";
    setTrackerHistoryRange(24);
    void loadTrackerHistory(true);
  });
  document.querySelectorAll("button[data-tracker-range-hours]").forEach((button) => button.addEventListener("click", () => {
    setTrackerHistoryRange(Number(button.dataset.trackerRangeHours) || 24);
    void loadTrackerHistory(true);
  }));
  trackerHistoryLoadMore?.addEventListener("click", () => { void loadTrackerHistory(false); });
  trackerHistoryRouteButton?.addEventListener("click", openTrackerHistoryRoute);
  trackerHistoryRows?.addEventListener("click", (event) => {
    const mapButton = event.target.closest("button[data-history-map-url]");
    if (mapButton?.dataset.historyMapUrl) window.location.assign(mapButton.dataset.historyMapUrl);
  });
  trackerDialogBody?.addEventListener("click", (event) => {
    const mapButton = event.target.closest("button[data-tracker-map-url]");
    if (!mapButton?.dataset.trackerMapUrl) return;
    window.location.assign(mapButton.dataset.trackerMapUrl);
  });
  trackerRefreshButton?.addEventListener("click", requestTrackerRefresh);
  trackerVehicleDialog?.querySelectorAll("[data-tracker-close]").forEach((button) => button.addEventListener("click", () => trackerVehicleDialog.close()));
  trackerVehicleDialog?.addEventListener("click", (event) => { if (event.target === trackerVehicleDialog) trackerVehicleDialog.close(); });
  trackerVehicleDialog?.addEventListener("close", () => { state.trackerVehicleKey = ""; updateQueryState({ tracker: "" }); });

  restoreFilterState(); restoreTrackerHistoryFilters(); setDefaultDeparture(); applyLanguage();
  setAppLoading("正在加载车辆调度", "正在确认登录状态…");
  if (view === "overview") showOverview(); else if (view === "apply") showMobileHome(); else if (view === "return" && !params.get("record")) showReturnPicker(); else if (view === "transfer" && !params.get("record")) showTransferPicker(); else if (view === "departure") openEditor(); else if (view === "booking") openBooking(); else if (view === "history") openHistory(); else if (view === "tracker-history") openTrackerHistory(params.get("trackerVehicle") || "", false, false); else if (view === "settings") openSettings(); else if (view === "vehicle-options") openVehicleOptions();
  async function openRequestedView() {
    if (view === "return" && params.get("record")) { const task = state.tasks.find((item) => item.recordId === params.get("record")); if (task) openReturn(task); else showReturnPicker(); }
    else if (view === "transfer" && params.get("record")) { const task = state.tasks.find((item) => item.recordId === params.get("record")); if (task) openTransfer(task); else showTransferPicker(); }
    else if (view === "edit" && params.get("record")) { const task = state.tasks.find((item) => item.recordId === params.get("record")); if (task) openEditor(task); }
    else if (view === "edit" && params.get("vehicle")) openEditor(null, params.get("vehicle"));
    else if (view === "vehicle" && params.get("table") && params.get("record")) openVehicleDetail(params.get("table"), params.get("record"), false);
    else if (view === "vehicle-edit" && params.get("table") && params.get("record")) openVehicleEditor(params.get("table"), params.get("record"), false);
    else if (view === "vehicle-edit" && params.get("create") === "sold" && userCan("manage_vehicles")) openSoldVehicleCreator();
    else if (view === "history") renderHistory();
    else if (view === "tracker-history") openTrackerHistory(params.get("trackerVehicle") || "", false, true);
    else if (view === "settings") openSettings();
    else if (view === "vehicle-options") openVehicleOptions();
    else if (view === "return") showReturnPicker();
    else if (view === "transfer") showTransferPicker();
    const trackerTarget = params.get("tracker") || "";
    const separator = trackerTarget.indexOf(":");
    if (separator > 0) openTrackerVehicle(trackerTarget.slice(0, separator), trackerTarget.slice(separator + 1), false);
  }

  loadCurrentUser().then(async (signedIn) => {
    if (!signedIn) return;
    setAppLoading("正在加载车辆调度", "正在读取账户权限…");
    // Hydrate the signed-in user's cache before any remote option request.
    loadOptionsCache();
    setAppLoading("正在加载车辆调度", "正在读取车辆和任务数据…");
    const tasksPromise = loadTasks();
    const optionsPromise = loadOptions();
    void Promise.all([loadNotificationSettings(), loadPhotoSyncStatus(), loadTrackerStatus()]);
    window.setInterval(() => { void loadTrackerStatus(); }, 60_000);
    // Do not reveal a mobile workflow until its vehicle/task choices are
    // usable. This avoids a blank selector that looks like a stalled tap.
    if (isMobile || params.get("record")) await Promise.all([tasksPromise, optionsPromise]);
    setAppLoading("正在加载车辆调度", "正在打开目标页面…");
    await openRequestedView();
    hideAppLoading();
  }).catch((error) => {
    setAppLoading("加载失败", error.message || "请检查网络后重试");
    setNotice(`加载应用失败：${error.message}`, "error");
  });

  // Cover the current shell while a full navigation is waiting on the
  // server. Restore it on bfcache return instead of leaving a stale overlay.
  window.addEventListener("pagehide", () => {
    if (appReady) showAppLoading();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && appReady) hideAppLoading();
  });
})();
