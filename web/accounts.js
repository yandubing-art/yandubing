(() => {
  const $ = (id) => document.getElementById(id);
  sessionStorage.setItem("dispatch_entry_mode_v1", "desktop");
  const state = { language: sessionStorage.getItem("dispatch_language") === "en" ? "en" : "zh", accounts: [], departments: [] };
  const fallbackDepartments = ["Operations | 运营部", "Transport | 运输部", "Drivers | 司机组", "Procurement | 采购部", "Administration | 行政部", "Warehouse | 仓库部", "Maintenance | 维护部", "Store | 门店", "Tophida"];
  const texts = { "车辆调度控制台": "Vehicle Dispatch Console", "账号管理": "Account management", "按模块、数据范围和具体操作分配账号权限": "Assign account access by module, data scope and operation", "为 Lark 账号和独立账号分配角色与调度权限": "Assign roles and dispatch permissions to Lark and independent accounts", "桌面调度台": "Desktop console", "移动调度": "Mobile dispatch", "退出登录": "Sign out", "Lark 账号与独立账号": "Lark and independent accounts", "默认推荐使用 Lark；为新用户连接一次 Lark 后即可在下表分配部门、角色和权限。": "Lark is recommended. Connect a new user once, then assign department, role and permissions below.", "授权后角色": "Role after authorization", "添加 Lark 账号": "Add Lark account", "新建独立账号": "Create independent account", "仅在无法使用 Lark 时使用；独立账号不会自动获得管理员权限。": "Use only when Lark is unavailable; independent accounts do not receive admin access automatically.", "Lark 授权链接已生成": "Lark authorization link generated", "把此链接发给员工，员工用自己的 Lark 账号完成授权后，会自动进入移动调度；所选角色会同步写入账号管理。": "Send this link to the employee. After authorizing with their Lark account, they will enter mobile dispatch and receive the selected role.", "复制链接": "Copy link", "打开授权": "Open authorization", "Lark 授权链接生成成功，请发给对应员工完成授权。": "Lark authorization link generated. Send it to the employee to complete authorization.", "Lark 授权链接已复制。": "Lark authorization link copied.", "请手动复制授权链接。": "Please copy the authorization link manually.", "Lark 账号已登记，权限已保存。": "The Lark account has been registered and its role saved.", "Lark 授权链接生成失败。": "Unable to generate the Lark authorization link.", "显示名称": "Display name", "所属部门": "Department", "未分配部门": "No department", "账号名": "Username", "初始密码": "Initial password", "角色": "Role", "创建账号": "Create account", "账号与权限": "Accounts and permissions", "调度员仅能使用移动调度；其余角色按职责开放桌面、同步、车辆或账号管理权限。": "Dispatchers only use mobile dispatch; other roles receive desktop, sync, fleet or account permissions as appropriate.", "账号": "Account", "来源": "Source", "状态": "Status", "最后登录": "Last sign-in", "操作": "Actions", "正在读取账号…": "Loading accounts…", "保存": "Save", "启用": "Active", "停用": "Disabled", "独立账号": "Independent", "Lark 账号": "Lark", "调度员": "Dispatcher", "排程员": "Scheduler", "车队管理员": "Fleet manager", "管理员": "Administrator", "账号已创建。": "Account created.", "账号已更新。": "Account updated.", "加载账号失败。": "Unable to load accounts.", "更新失败。": "Update failed.", "创建失败。": "Creation failed." };
  Object.assign(texts, { "自动模式": "Auto mode", "日间模式": "Day mode", "夜间模式": "Night mode" });
  Object.assign(texts, { "返回桌面调度台": "Back to desktop console" });
  Object.assign(texts, {
    "角色提供默认权限；保存时可为单个账号单独调整，包括跨部门车辆权限。": "Roles provide defaults; save detailed per-account access, including task scope and cross-department vehicles.",
    "权限": "Permissions", "权限概览": "Access summary", "权限管理": "Permission settings", "单独编辑": "Edit individually", "无权限": "No access", "跨部门车辆": "Cross-department vehicles", "同步调度": "Dispatch sync", "车辆管理": "Fleet management", "账号管理": "Account management",
    "移动调度": "Mobile dispatch", "任务访问": "Task access", "车辆与车况": "Vehicles and condition", "桌面与数据": "Desktop and data", "系统管理": "System administration",
    "进入移动调度": "Open mobile dispatch", "创建出发任务": "Create departure task", "编辑自己的任务": "Edit own tasks", "出发登记": "Submit departure", "中转登记": "Submit transfer", "返回登记": "Submit return", "上传任务照片": "Upload task photos", "预约车辆": "Book vehicles",
    "查看自己的任务": "View own tasks", "查看全部任务": "View all tasks", "编辑全部任务": "Edit all tasks", "审批车辆预约": "Approve vehicle bookings", "删除/取消任务": "Delete or cancel tasks",
    "车辆档案管理": "Manage vehicle records", "车辆照片管理": "Manage vehicle photos", "保养与保修": "Manage maintenance and warranty", "刷新 Tracker": "Refresh Tracker",
    "桌面调度台": "Open desktop console", "出行记录": "View trip history", "Tracker 历史": "View Tracker history",
    "飞书照片同步": "Manage Lark photo sync", "部门通知设置": "Manage department notifications", "账号权限管理": "Manage account permissions",
    "可查看并选择其他部门的可调度车辆。": "View and select dispatchable vehicles from other departments.",
    "允许进入手机调度页面并读取基础选项。": "Allow access to mobile dispatch and its basic options.", "可新建一条出发调度任务。": "Create a new departure dispatch task.", "只可修改自己作为驾驶人的任务。": "Edit only tasks where this user is the driver.", "提交车辆出发登记并进入执行中。": "Submit the vehicle departure check and start execution.", "登记任务中转地点。": "Record a transfer location for a departed task.", "登记返程路线、里程和车况。": "Record return route, mileage and vehicle condition.", "上传出发或返程车辆照片。": "Upload departure or return vehicle photos.", "发起车辆预约申请。": "Create a vehicle booking request.",
    "读取自己创建或作为驾驶人的任务。": "Read tasks created by or assigned to this user.", "读取所有调度任务和部门任务。": "Read all dispatch and department tasks.", "修改其他人员的调度任务。": "Edit dispatch tasks belonging to other users.", "同意或拒绝车辆预约。": "Approve or reject vehicle booking requests.", "删除任务或在无法删除时取消归档。": "Delete tasks or cancel-archive them when deletion is unavailable.",
    "维护车辆基本资料、状态和档案。": "Manage vehicle profile, status and records.", "上传和维护车辆原图及附件。": "Upload and maintain vehicle originals and attachments.", "记录保养、保修单和下次保养计划。": "Record maintenance, warranty files and next service plans.", "发起 Tracker 数据刷新。": "Queue a Tracker data refresh.",
    "进入桌面调度台。": "Open the desktop operations console.", "查看出行记录。": "View trip records and filters.", "查看车辆 Tracker 历史。": "View historical Tracker records.", "手动执行调度同步。": "Run dispatch synchronization manually.",
    "连接拥有 Base 权限的管理员并同步车辆照片。": "Connect a Base administrator and sync vehicle photos.", "编辑部门出发、返程和预约通知目标。": "Edit department targets for departure, return and booking notices.", "编辑账号、角色、部门和权限。": "Edit accounts, roles, departments and permissions."
  });
  const reverse = Object.fromEntries(Object.entries(texts).map(([zh, en]) => [en, zh]));
  const t = (value) => state.language === "en" ? (texts[value] || value) : (reverse[value] || value);
  const roleLabel = (role) => t(({ dispatcher: "调度员", scheduler: "排程员", fleet_manager: "车队管理员", admin: "管理员" })[role] || "调度员");
  const sourceLabel = (source) => t(source === "lark" ? "Lark 账号" : "独立账号");
  const setNotice = (message, kind = "") => { const n = $("accountNotice"); n.textContent = message; n.className = `account-status ${kind}`.trim(); };
  const updateLarkInviteRole = () => $("larkAccountRole")?.value || "dispatcher";
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);
  const formatDate = (value) => value ? new Date(value).toLocaleString(state.language === "en" ? "en-GB" : "zh-CN", { hour12: false }) : "—";
  const departmentOptions = (selected = "") => {
    const departments = [...new Set([...fallbackDepartments, ...state.departments, ...state.accounts.map((account) => account.department).filter(Boolean), selected].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return `<option value="">${t("未分配部门")}</option>${departments.map((department) => `<option value="${esc(department)}" ${department === selected ? "selected" : ""}>${esc(department)}</option>`).join("")}`;
  };
  const roleDefaults = {
    dispatcher: ["mobile_dispatch", "view_own_tasks", "create_dispatch", "edit_own_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "view_all_vehicles"],
    scheduler: ["mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "approve_bookings", "desktop_console", "view_history", "view_tracker_history", "sync_dispatch", "delete_dispatch", "view_all_vehicles"],
    fleet_manager: ["mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "desktop_console", "view_history", "view_tracker_history", "view_all_vehicles", "manage_vehicles", "manage_vehicle_photos", "manage_maintenance", "refresh_tracker", "manage_photo_sync"],
    admin: ["mobile_dispatch", "view_own_tasks", "view_all_tasks", "create_dispatch", "edit_own_dispatch", "edit_all_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle", "approve_bookings", "desktop_console", "view_history", "view_tracker_history", "sync_dispatch", "delete_dispatch", "view_all_vehicles", "manage_vehicles", "manage_vehicle_photos", "manage_maintenance", "refresh_tracker", "manage_photo_sync", "manage_accounts", "manage_notifications"]
  };
  const permissionGroups = [
    { label: "移动调度", permissions: [["mobile_dispatch", "进入移动调度", "允许进入手机调度页面并读取基础选项。"], ["view_all_vehicles", "跨部门车辆", "可查看并选择其他部门的可调度车辆。"], ["create_dispatch", "创建出发任务", "可新建一条出发调度任务。"], ["edit_own_dispatch", "编辑自己的任务", "只可修改自己作为驾驶人的任务。"], ["submit_departure", "出发登记", "提交车辆出发登记并进入执行中。"], ["submit_transfer", "中转登记", "登记任务中转地点。"], ["submit_return", "返回登记", "登记返程路线、里程和车况。"], ["submit_photos", "上传任务照片", "上传出发或返程车辆照片。"], ["book_vehicle", "预约车辆", "发起车辆预约申请。"]] },
    { label: "任务访问", permissions: [["view_own_tasks", "查看自己的任务", "读取自己创建或作为驾驶人的任务。"], ["view_all_tasks", "查看全部任务", "读取所有调度任务和部门任务。"], ["edit_all_dispatch", "编辑全部任务", "修改其他人员的调度任务。"], ["approve_bookings", "审批车辆预约", "同意或拒绝车辆预约。"], ["delete_dispatch", "删除/取消任务", "删除任务或在无法删除时取消归档。"]] },
    { label: "车辆与车况", permissions: [["manage_vehicles", "车辆档案管理", "维护车辆基本资料、状态和档案。"], ["manage_vehicle_photos", "车辆照片管理", "上传和维护车辆原图及附件。"], ["manage_maintenance", "保养与保修", "记录保养、保修单和下次保养计划。"], ["refresh_tracker", "刷新 Tracker", "发起 Tracker 数据刷新。"]] },
    { label: "桌面与数据", permissions: [["desktop_console", "桌面调度台", "进入桌面调度台。"], ["view_history", "出行记录", "查看出行记录。"], ["view_tracker_history", "Tracker 历史", "查看车辆 Tracker 历史。"], ["sync_dispatch", "同步调度", "手动执行调度同步。"]] },
    { label: "系统管理", permissions: [["manage_photo_sync", "飞书照片同步", "连接拥有 Base 权限的管理员并同步车辆照片。"], ["manage_notifications", "部门通知设置", "编辑部门出发、返程和预约通知目标。"], ["manage_accounts", "账号权限管理", "编辑账号、角色、部门和权限。"]] }
  ];
  const legacyExpansion = { mobile_dispatch: ["view_own_tasks", "create_dispatch", "edit_own_dispatch", "submit_departure", "submit_transfer", "submit_return", "submit_photos", "book_vehicle"], desktop_console: ["view_all_tasks", "edit_all_dispatch", "view_history", "view_tracker_history"], sync_dispatch: ["approve_bookings", "delete_dispatch"], manage_vehicles: ["manage_vehicle_photos", "manage_maintenance", "refresh_tracker"], manage_accounts: ["manage_notifications"] };
  const expandedPermissions = (permissions, role, version) => {
    const selected = new Set(Array.isArray(permissions) && permissions.length ? permissions : (roleDefaults[role] || []));
    if (version !== 2) [...selected].forEach((permission) => (legacyExpansion[permission] || []).forEach((expanded) => selected.add(expanded)));
    return selected;
  };
  const permissionEditor = (account) => {
    const selected = expandedPermissions(account.permissions, account.role, account.permissionsVersion);
    const summary = permissionGroups.map((group) => { const count = group.permissions.filter(([value]) => selected.has(value)).length; return count ? `<span>${esc(t(group.label))} · ${count}</span>` : ""; }).filter(Boolean).join("");
    return `<div class="account-permission-summary"><div class="account-permission-summary-items">${summary || `<span>${esc(t("无权限"))}</span>`}</div><a class="button button-quiet account-permission-link" href="/permissions?account=${encodeURIComponent(account.id)}">${esc(t("单独编辑"))}</a></div>`;
  };
  const render = () => {
    const rows = $("accountsRows");
    $("createDepartment").innerHTML = departmentOptions();
    rows.innerHTML = state.accounts.length ? state.accounts.map((account) => `<tr><td><strong>${esc(account.displayName)}</strong><div class="account-source">${esc(account.username)}${account.email ? ` · ${esc(account.email)}` : ""}</div></td><td><select data-department="${esc(account.id)}" aria-label="${esc(`${t("所属部门")} · ${account.displayName}`)}">${departmentOptions(account.department || "")}</select></td><td>${sourceLabel(account.source)}</td><td><select data-role="${esc(account.id)}" aria-label="${esc(`${t("角色")} · ${account.displayName}`)}"><option value="dispatcher" ${account.role === "dispatcher" ? "selected" : ""}>${roleLabel("dispatcher")}</option><option value="scheduler" ${account.role === "scheduler" ? "selected" : ""}>${roleLabel("scheduler")}</option><option value="fleet_manager" ${account.role === "fleet_manager" ? "selected" : ""}>${roleLabel("fleet_manager")}</option><option value="admin" ${account.role === "admin" ? "selected" : ""}>${roleLabel("admin")}</option></select></td><td>${permissionEditor(account)}</td><td><label><input data-active="${esc(account.id)}" type="checkbox" ${account.active ? "checked" : ""} /> ${t(account.active ? "启用" : "停用")}</label></td><td>${formatDate(account.lastLoginAt)}</td><td class="account-actions"><button class="button button-quiet" data-save="${esc(account.id)}" type="button">${t("保存")}</button></td></tr>`).join("") : `<tr><td colspan="8" class="empty">${t("正在读取账号…")}</td></tr>`;
  };
  const loadDepartments = async () => {
    try {
      const response = await fetch("/api/options");
      if (!response.ok) return;
      const payload = await response.json();
      state.departments = [...new Set((payload.users || []).map((user) => String(user.department || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    } catch { /* Fallback department choices remain available offline. */ }
  };
  const load = async () => {
    try { await loadDepartments(); const response = await fetch("/api/auth/accounts"); if (!response.ok) throw new Error(); const payload = await response.json(); state.accounts = payload.accounts || []; render(); }
    catch { setNotice(t("加载账号失败。"), "error"); }
  };
  const generateLarkInvite = async () => {
    const button = $("addLarkAccountButton");
    button.disabled = true;
    try {
      const response = await fetch(`/api/admin/lark-account/start?role=${encodeURIComponent(updateLarkInviteRole())}`);
      const payload = await response.json();
      if (!response.ok || !payload.url) throw new Error(payload.error || t("Lark 授权链接生成失败。"));
      $("larkInviteUrl").value = payload.url;
      $("openLarkInviteButton").href = payload.url;
      $("larkInvitePanel").hidden = false;
      setNotice(t("Lark 授权链接生成成功，请发给对应员工完成授权。"));
    } catch (error) { setNotice(error.message || t("Lark 授权链接生成失败。"), "error"); }
    finally { button.disabled = false; }
  };
  const translate = () => {
    document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
    document.title = `${t("账号管理")} · ${t("车辆调度控制台")}`;
    $("languageToggle").textContent = state.language === "en" ? "中文" : "English";
    $("languageToggle").setAttribute("aria-label", state.language === "en" ? "Switch to Chinese" : "切换为英文");
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
    render();
  };
  document.querySelectorAll(".account-page *").forEach((element) => { if (element.children.length === 0 && element.textContent.trim()) element.dataset.i18n = element.textContent.trim(); if (element.placeholder) element.dataset.i18nPlaceholder = element.placeholder; });
  $("languageToggle").addEventListener("click", () => { state.language = state.language === "en" ? "zh" : "en"; sessionStorage.setItem("dispatch_language", state.language); translate(); window.dispatchEvent(new Event("dispatch:language")); });
  $("addLarkAccountButton").addEventListener("click", generateLarkInvite);
  $("copyLarkInviteButton").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("larkInviteUrl").value); setNotice(t("Lark 授权链接已复制。")); } catch { $("larkInviteUrl").select(); setNotice(t("请手动复制授权链接。")); } });
  $("logoutButton").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.replace("/admin-login"); });
  $("createAccountForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { const response = await fetch("/api/auth/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data)) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); event.currentTarget.reset(); setNotice(t("账号已创建。")); await load(); }
    catch (error) { setNotice(error.message || t("创建失败。"), "error"); }
  });
  $("accountsRows").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-save]"); if (!button) return;
    const id = button.dataset.save; const department = document.querySelector(`[data-department="${CSS.escape(id)}"]`).value; const role = document.querySelector(`[data-role="${CSS.escape(id)}"]`).value; const active = document.querySelector(`[data-active="${CSS.escape(id)}"]`).checked;
    try { const response = await fetch(`/api/auth/accounts/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ department, role, active }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setNotice(t("账号已更新。")); await load(); }
    catch (error) { setNotice(error.message || t("更新失败。"), "error"); }
  });
  const query = new URLSearchParams(window.location.search);
  if (query.get("lark_account") === "added") setNotice(`${t("Lark 账号已登记，权限已保存。")}${query.get("name") ? ` · ${query.get("name")}` : ""}`);
  if (query.get("lark_error")) setNotice(query.get("lark_error"), "error");
  translate(); load();
})();
