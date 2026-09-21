(() => {
  const params = new URLSearchParams(window.location.search);
  const safeNext = (value) => value && value.startsWith("/") && !value.startsWith("//") ? value : "/?view=apply";
  const phoneLanguages = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  const browserLanguage = phoneLanguages.some((language) => /^zh(?:-|$)/i.test(String(language))) ? "zh" : "en";
  const languageOverride = sessionStorage.getItem("dispatch_language_override_v2");
  const state = { language: languageOverride === "en" || languageOverride === "zh" ? languageOverride : browserLanguage, next: safeNext(params.get("next")) };
  const $ = (id) => document.getElementById(id);
  const strings = {
    "车辆调度控制台": "Vehicle Dispatch Console", "使用公司 Lark 账号或独立账号进入。默认进入移动设备调度；有权限的账号可单独进入桌面调度台。": "Sign in with your company Lark account or an independent account. Mobile dispatch is the default; authorized users can open the desktop console.", "让每一次出发都清晰可追踪。统一连接公司人员、车辆与调度任务，默认进入移动设备调度。": "Keep every departure clear and traceable. Connect people, vehicles and dispatch tasks in one workspace, with mobile dispatch as the default.", "统一车队": "One fleet", "随时调度": "Always ready", "协同工作台": "Lark workspace", "移动调度": "Mobile dispatch", "桌面调度": "Desktop console", "车辆管理": "Vehicle management", "账号权限": "Account permissions", "登录调度系统": "Sign in to dispatch", "使用 Lark 账号登录": "Sign in with Lark", "使用独立账号登录": "Sign in with independent account", "其他登录方式": "Other sign-in options", "使用公司 Lark 账号安全登录，成功后进入移动设备调度。": "Sign in securely with your company Lark account and continue to mobile dispatch.", "或使用独立账号": "or use an independent account", "账号": "Username", "密码": "Password", "输入账号": "Enter username", "输入密码": "Enter password", "登录并进入移动调度": "Sign in to mobile dispatch", "后台管理登录": "Admin portal sign-in", "预约车辆": "Reserve a vehicle", "预览测试入口": "Preview test access", "仅用于本地体验，不适用于正式上线。": "For local evaluation only; unavailable in production.", "使用预览管理员账号": "Use preview administrator", "账号由管理员分配角色：调度员、排程员、车队管理员或管理员。": "Administrators assign one of four roles: dispatcher, scheduler, fleet manager or administrator.", "登录失败，请重试。": "Sign-in failed. Please try again.", "正在登录…": "Signing in…", "Lark 登录未配置": "Lark sign-in is not configured", "登录已取消": "Sign-in was cancelled", "VALUECO OPERATIONS SYSTEM": "VALUECO OPERATIONS SYSTEM"
  };
  Object.assign(strings, { "自动模式": "Auto mode", "日间模式": "Day mode", "夜间模式": "Night mode" });
  const reverse = Object.fromEntries(Object.entries(strings).map(([zh, en]) => [en, zh]));
  const t = (value) => state.language === "en" ? (strings[value] || value) : (reverse[value] || value);
  const translate = () => {
    document.documentElement.lang = state.language === "en" ? "en" : "zh-CN";
    document.title = `${t("登录调度系统")} · ${t("车辆调度控制台")}`;
    $("loginLanguageToggle").textContent = state.language === "en" ? "中文" : "English";
    $("loginLanguageToggle").setAttribute("aria-label", state.language === "en" ? "Switch to Chinese" : "切换为英文");
    document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  };
  document.querySelectorAll(".auth-page *").forEach((element) => {
    if (element.children.length === 0 && element.textContent.trim()) element.dataset.i18n = element.textContent.trim();
    if (element.placeholder) element.dataset.i18nPlaceholder = element.placeholder;
  });
  const setMessage = (message, type = "") => { const element = $("loginError"); element.textContent = message; element.className = `auth-message ${type}`.trim(); };
  const login = async (next) => {
    const form = new FormData($("localLoginForm"));
    setMessage(t("正在登录…"));
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password"), next }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("登录失败，请重试。"));
      window.location.replace(payload.redirect || next);
    } catch (error) { setMessage(error.message || t("登录失败，请重试。"), "error"); }
  };
  $("localLoginForm").addEventListener("submit", (event) => { event.preventDefault(); login(state.next); });
  $("previewLoginButton").addEventListener("click", async () => {
    const response = await fetch("/api/auth/preview-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next: state.next }) });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.error || t("登录失败，请重试。"), "error"); return; }
    window.location.replace(payload.redirect || state.next);
  });
  $("loginLanguageToggle").addEventListener("click", () => { state.language = state.language === "en" ? "zh" : "en"; sessionStorage.setItem("dispatch_language_override_v2", state.language); translate(); window.dispatchEvent(new Event("dispatch:language")); });
  fetch("/api/auth/providers").then((response) => response.json()).then((providers) => {
    $("larkLogin").hidden = !providers.lark;
    $("larkLoginHint").hidden = !providers.lark;
    $("loginDivider").hidden = !providers.lark;
    $("localLoginOption").open = !providers.lark;
    $("previewTools").hidden = !providers.preview;
    if (providers.lark) $("larkLogin").href = `/api/auth/lark/start?next=${encodeURIComponent(state.next)}`;
  }).catch(() => { $("localLoginOption").open = true; setMessage(t("登录失败，请重试。"), "error"); });
  if (params.get("error")) setMessage(params.get("error"), "error");
  translate();
})();
