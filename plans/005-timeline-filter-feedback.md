# 005 - Add lightweight timeline refresh feedback

- **Status**: IMPLEMENTED
- **Commit**: unavailable - this source bundle does not contain `.git`
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 1 file, targeted JavaScript feedback

## Problem

Changing timeline scale or date filters replaces `#taskTimeline` in one assignment. The refresh is intentional and fast, but it teleports the result without acknowledging that the filter took effect.

```js
/* web/app.js:508-509 - current */
if (!groups.size) { taskTimeline.innerHTML = `<div class="empty-card">${t("没有匹配的调度任务。")}</div>`; return; }
taskTimeline.innerHTML = [...groups.entries()] /* complete rendered timeline */;

/* web/app.js:1758-1760 - current */
button.addEventListener("click", () => { state.timelineScale = button.dataset.timelineScale || "day"; /* ... */ renderTimeline(); });
[$("timelineDateFrom"), $("timelineDateTo")].forEach((input) => input?.addEventListener("change", renderTimeline));
```

## Target

Reuse `playConfirmationFeedback()` from plan 004 with a mode that is opacity-only on every preference. The timeline container should fade from `opacity: 0.72` to `1` over `160ms` using `cubic-bezier(0.23, 1, 0.32, 1)`. It must never move, stagger, or animate individual timeline items.

```js
function playTimelineRefreshFeedback(element) {
  if (!element?.animate) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate(
    [{ opacity: 0.72 }, { opacity: 1 }],
    { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "none" }
  );
}
```

At the end of `renderTimeline()`, call the helper after every non-initial user filter refresh. Prevent it from running during initial `loadTasks()` rendering by adding an explicit optional argument such as `renderTimeline({ feedback: false })`; UI event handlers pass `{ feedback: true }`.

## Repo conventions to follow

- `renderRows()` calls `renderTimeline()` at `web/app.js:422` and `430`; those data loads must stay visually quiet.
- The timeline is used frequently. Its feedback must be one container fade, not list entry animation.
- Plan 004 supplies the rare state-change helper, but this plan should use a separate opacity-only helper to avoid movement.

## Steps

1. Change `renderTimeline()` to accept an options object with `feedback` defaulting to `false`.
2. Call `playTimelineRefreshFeedback(taskTimeline)` at the end of both empty and non-empty render paths only when `feedback` is true.
3. Update the scale-button, date-input, and clear-button listeners at `web/app.js:1758-1760` to pass `{ feedback: true }`.
4. Leave all calls from `renderRows()` and `loadTasks()` at the default, quiet behavior.
5. Ensure a rapid sequence of date changes cancels the previous fade rather than stacking animations.

## Boundaries

- Do not animate rows, groups, dates, or badges individually.
- Do not modify filtering semantics, date calculations, scroll positions, task selection, or empty-state text.
- Do not add a `setTimeout`, rAF loop, dependency, or CSS blur.

## Verification

- **Mechanical**: filter the timeline by date, clear filters, and change scale. Only the timeline region should animate.
- **Feel check**: repeat changes rapidly; there should be no queue of fades and no visible double exposure.
- **Accessibility check**: reduced motion remains opacity-only, which is already the target behavior.
- **Done when**: filtering feels acknowledged but does not slow task scanning or interfere with selection.
