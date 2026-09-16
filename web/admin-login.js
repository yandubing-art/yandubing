(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const safeNext = (value) => value && value.startsWith("/") && !value.startsWith("//") ? value : "/?view=overview";
  const state = { language: sessionStorage.getItem("dispatch_language") === "en" ? "en" : "zh", next: safeNext(params.get("next")) };
  const strings = {
    "车辆调度后台管理": "Vehicle Dispatch Administration",
    "后台管理用于进入桌面调度台、车辆总览和账号权限管理，仅限管理员账号使用。": "Administration provides access to the desktop console, vehicle overview and account permissions. Administrator accounts only.",
    "在一个清晰的运营后台管理车辆总览、调度任务和账号权限，让车队状态始终可见。": "Manage the fleet overview, dispatch tasks and account permissions in one clear operations hub.",
    "车辆总览": "Fleet overview", "任务调度": "Task operations", "权限管理": "Role access", "VALUECO OPERATIONS SYSTEM": "VALUECO OPERATIONS SYSTEM",
    "桌面调度": "Desktop console", "车辆管理": "Vehicle management", "账号权限": "Account permissions",
    "后台管理登录": "Admin portal sign-in", "管理员账号": "Administrator username", "密码": "Password",
    "输入管理员账号": "Enter administrator username", "输入密码": "Enter password",
    "登录后台管理": "Sign in to administration", "返回移动调度登录": "Back to mobile dispatch sign-in",
    "请使用由系统管理员分配的管理员账号。Lark 账号和普通独立账号不能进入后台管理。": "Use an administrator account assigned by a system administrator. Lark accounts and standard independent accounts cannot enter administration.",
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
  translate();
})();
