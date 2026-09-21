(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const safeNext = (value) => value && value.startsWith("/") && !value.startsWith("//") ? value : "/?view=overview";
  const state = { language: sessionStorage.getItem("dispatch_language") === "en" ? "en" : "zh", next: safeNext(params.get("next")) };
  const strings = {
    "车辆调度后台管理": "Vehicle Dispatch Administration",
    "后台管理用于进入桌面调度台、车辆总览和账号权限管理，仅限管理员账号使用。": "Administration provides access to the desktop console, vehicle overview and account permissions. Administrator accounts only.",
    "在一个清晰的运营后台管理车辆总览、调度任务和账号权限；Lark 与独立账号都会按角色权限进入。": "Manage the fleet overview, dispatch tasks and account permissions in one clear operations hub; Lark and independent accounts enter according to role permissions.",
    "车辆总览": "Fleet overview", "任务调度": "Task operations", "权限管理": "Role access", "VALUECO OPERATIONS SYSTEM": "VALUECO OPERATIONS SYSTEM",
    "桌面调度": "Desktop console", "车辆管理": "Vehicle management", "账号权限": "Account permissions",
    "后台管理登录": "Admin portal sign-in", "管理员账号": "Administrator username", "密码": "Password",
    "输入管理员账号": "Enter administrator username", "输入密码": "Enter password",
    "登录后台管理": "Sign in to administration", "使用 Lark 账号登录后台": "Sign in to administration with Lark", "或使用管理员独立账号": "or use an administrator account", "使用公司 Lark 账号登录；登录后仍会按照角色和权限决定能否进入后台管理。": "Sign in with your company Lark account; your role and permissions still determine access to administration.", "返回移动调度登录": "Back to mobile dispatch sign-in",
    "Lark 账号和独立账号都需要经过角色权限校验；进入权限管理需要 `manage_accounts` 权限。": "Lark and independent accounts are both checked by role permissions; permission management requires `manage_accounts`.",
    "正在登录…": "Signing in…", "管理员账号或密码错误": "Incorrect administrator username or password", "登录失败，请重试。": "Sign-in failed. Please try again."
  };
  Object.assign(strings, { "自动模式": "Auto mode", "日间模式": "Day mode", "夜间模式": "Night mode" });
  const reverse = Object.fromEntries(Object.entries(strings).map(([zh, en]) => [en, zh]));
  const t = (value) => state.language === "en" ? (strings[value] || value) : (reverse[value] || value);
  document.querySelectorAll(".auth-page *").forEach((element) => {
    if (element.children.length === 0 && element.textContent.trim()) element.dataset.i18n = element.textContent.trim();
    if (element.placeholder) element.dataset.i18nPlaceholder = element.placeholder;
  });
  const translate = () => {
    document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
    document.title = `${t("后台管理登录")} · ${t("车辆调度后台管理")}`;
    $("adminLanguageToggle").textContent = state.language === "en" ? "中文" : "English";
    $("adminLanguageToggle").setAttribute("aria-label", state.language === "en" ? "Switch to Chinese" : "切换为英文");
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  };
  const setMessage = (message, type = "") => { const element = $("adminLoginError"); element.textContent = message; element.className = `auth-message ${type}`.trim(); };
  $("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData($("adminLoginForm"));
    setMessage(t("正在登录…"));
    try {
      const response = await fetch("/api/auth/admin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password"), next: state.next }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("登录失败，请重试。"));
      window.location.replace(payload.redirect || state.next);
    } catch (error) { setMessage(error.message || t("登录失败，请重试。"), "error"); }
  });
  $("adminLanguageToggle").addEventListener("click", () => { state.language = state.language === "en" ? "zh" : "en"; sessionStorage.setItem("dispatch_language", state.language); translate(); window.dispatchEvent(new Event("dispatch:language")); });
  fetch("/api/auth/providers").then((response) => response.json()).then((providers) => {
    $("larkAdminLogin").hidden = !providers.lark;
    $("larkAdminLoginHint").hidden = !providers.lark;
    $("adminLoginDivider").hidden = !providers.lark;
    if (providers.lark) $("larkAdminLogin").href = `/api/auth/lark/start?admin=1&next=${encodeURIComponent(state.next)}`;
  }).catch(() => {
    $("larkAdminLogin").hidden = true;
    $("larkAdminLoginHint").hidden = true;
    $("adminLoginDivider").hidden = true;
  });
  translate();
})();
