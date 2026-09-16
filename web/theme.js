(() => {
  const storageKey = "dispatch_theme_mode";
  const modes = ["auto", "day", "night"];
  const labels = {
    zh: { auto: "自动模式", day: "日间模式", night: "夜间模式", next: "切换显示模式" },
    en: { auto: "Auto mode", day: "Day mode", night: "Night mode", next: "Change display mode" }
  };
  let mode = "auto";
  try { mode = localStorage.getItem(storageKey) || "auto"; } catch (_) { /* Private browsing may block storage; auto mode still works. */ }
  if (!modes.includes(mode)) mode = "auto";

  function effectiveMode() {
    if (mode !== "auto") return mode;
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "day" : "night";
  }

  function language() {
    return document.documentElement.lang === "en" || sessionStorage.getItem("dispatch_language") === "en" ? "en" : "zh";
  }

  function apply() {
    const lang = labels[language()];
    const resolvedMode = effectiveMode();
    document.documentElement.dataset.theme = resolvedMode;
    document.documentElement.dataset.themeMode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedMode === "night" ? "#05060a" : "#f4f7fb");
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.textContent = lang[mode];
      button.setAttribute("aria-label", `${lang.next} · ${lang[mode]}`);
      button.title = `${lang.next} · ${lang[mode]}`;
    });
  }

  function cycle() {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    try { localStorage.setItem(storageKey, mode); } catch (_) { /* Keep the current mode for this page when storage is unavailable. */ }
    apply();
  }

  document.querySelectorAll(".theme-toggle").forEach((button) => button.addEventListener("click", cycle));
  window.addEventListener("dispatch:language", apply);
  window.setInterval(() => { if (mode === "auto") apply(); }, 60_000);
  apply();
})();
