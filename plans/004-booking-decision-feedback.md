# 004 - Add restrained booking-decision confirmation feedback

- **Status**: IMPLEMENTED
- **Commit**: unavailable - this source bundle does not contain `.git`
- **Severity**: LOW
- **Category**: Missed opportunity
- **Estimated scope**: 2 files, targeted feedback only

## Problem

Approving or rejecting a vehicle booking refreshes the complete dataset and then replaces the notice text. The resulting change is correct but visually abrupt, especially because the approved item disappears from the reservation queue.

```js
/* web/app.js:1128-1135 - current */
setNotice(approving ? "正在确认预约并排程…" : "正在拒绝车辆预约…");
try {
  const response = await fetch(/* ... */);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  await loadTasks();
  setNotice(approving ? "车辆预约已同意，状态已更新为已排程。" : "车辆预约已拒绝并保留记录。", "success");
}
```

## Target

Add one reusable feedback helper for rare, successful state transitions. It must cancel its own preceding run, animate only `opacity` and `transform`, finish in `180ms`, and use `cubic-bezier(0.23, 1, 0.32, 1)`. With reduced motion, use opacity only for `200ms`.

```js
function playConfirmationFeedback(element) {
  if (!element?.animate) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  const reduced = prefersReducedMotion();
  element.animate(
    reduced
      ? [{ opacity: 0.55 }, { opacity: 1 }]
      : [{ opacity: 0.55, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: reduced ? 200 : 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "none" }
  );
}
```

Call it immediately after the successful `setNotice(...)` in `decideBooking()`. Do not animate the entire booking table or individual rows.

## Repo conventions to follow

- Use the existing `#notice` live region and `setNotice()` at `web/app.js:164`; do not add a toast library or new notification component.
- The booking queue is an operations surface, so feedback must be confirmation, not celebration.
- Plan 003 provides `prefersReducedMotion()`; this plan depends on it.

## Steps

1. Add `playConfirmationFeedback(element)` after the motion helpers introduced in plan 003.
2. After the success `setNotice()` at `web/app.js:1134`, invoke `playConfirmationFeedback(notice)`.
3. Do not invoke it for network failures, initial loads, retries, or ordinary table filtering.
4. Do not add keyframes, timers, rAF loops, layout animation, or per-row list entrances.

## Boundaries

- Do not change booking approval API calls, status text, user permissions, or notification delivery.
- Do not animate destructive rejection with a bounce, shake, or color flash.
- Do not add external dependencies.

## Verification

- **Mechanical**: approve one booking and reject one booking; each successful decision must trigger exactly one feedback run.
- **Feel check**: in DevTools slow-motion mode, the notice should settle once without replaying or jumping when multiple actions happen quickly.
- **Accessibility check**: with reduced motion enabled, confirm the notice only fades and the live-region message remains unchanged.
- **Done when**: a booking decision is visibly acknowledged without animating the operational queue.
