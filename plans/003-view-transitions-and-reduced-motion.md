# 003 - Make navigation and scrolling motion-aware

- **Status**: IMPLEMENTED
- **Commit**: unavailable - this source bundle does not contain `.git`
- **Severity**: HIGH
- **Category**: Easing, accessibility, and interruptibility
- **Estimated scope**: 2 files, small JavaScript and CSS changes

## Problem

The View Transition exit animation uses an ease-in curve and is completely skipped when reduced motion is requested. Programmatic scrolling always requests smooth movement, including keyboard activation of a stat card.

```js
/* web/app.js:251-254 - current */
const motionReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
if (target && !$(target).hidden && document.startViewTransition && !motionReduced) return;
if (document.startViewTransition && !motionReduced) document.startViewTransition(update);
else update();

/* web/app.js:517 - current */
document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
```

```css
/* web/styles.css:619-625 - current */
::view-transition-old(root) { animation:dispatch-view-out 150ms cubic-bezier(.4,0,1,1) both; }
::view-transition-new(root) { animation:dispatch-view-in 220ms cubic-bezier(.16,1,.3,1) both; }
@media (prefers-reduced-motion:reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation:none; }
}
```

## Target

Use the shared `--motion-view: 200ms` and `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` from plan 001. Normal motion remains a short spatial handoff; reduced motion keeps an opacity-only crossfade. Smooth scroll switches to `auto` for reduced motion.

```js
function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function contextualScrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}
```

```css
::view-transition-old(root) { animation: dispatch-view-out var(--motion-view) var(--ease-out) both; }
::view-transition-new(root) { animation: dispatch-view-in var(--motion-view) var(--ease-out) both; }
@keyframes dispatch-view-out { to { opacity: 0; transform: translateY(-4px); } }
@keyframes dispatch-view-in { from { opacity: 0; transform: translateY(6px); } }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root) { animation: dispatch-fade-out 200ms var(--ease-out) both; }
  ::view-transition-new(root) { animation: dispatch-fade-in 200ms var(--ease-out) both; }
  .button:active { transform: none; }
}
@keyframes dispatch-fade-out { to { opacity: 0; } }
@keyframes dispatch-fade-in { from { opacity: 0; } }
```

Always use `document.startViewTransition(update)` when the browser supports it; the CSS media query selects the accessible animation. Keep the early return when the requested view is already visible, but do not gate it on reduced motion.

## Repo conventions to follow

- `web/app.js:242-254` is the central view switch. Do not add separate page-level animation code.
- `web/styles.css:2163` intentionally disables CSS global smooth scroll. Preserve it.
- The existing View Transitions API is the only navigation-motion API in the app; do not introduce a library.

## Steps

1. Add `prefersReducedMotion()` and `contextualScrollBehavior()` near other small helpers in `web/app.js`.
2. Update `showOnly()` at `web/app.js:242` to call View Transitions whenever supported, independent of the motion preference.
3. Replace each of the five `scrollIntoView({ behavior: "smooth" ... })` calls at lines 517, 1213, 1218, 1234, and 1767 with `behavior: contextualScrollBehavior()`.
4. Replace the view-transition block in `web/styles.css:618-626` with the exact normal and reduced-motion target CSS above.
5. Add the single reduced-motion active-state rule from plan 002; do not cancel color or opacity feedback.

## Boundaries

- Do not animate filters, table rows, or keyboard focus movement.
- Do not change URL/history behavior, page routing, or view visibility logic.
- Do not alter scroll containers, sticky headers, containment, or backdrop filters.

## Verification

- **Mechanical**: `rg -n 'behavior: "smooth"' web/app.js` should return no direct uses; all scrolls use the helper.
- **Feel check**: navigate between overview, booking, history, vehicle details, return, and transfer views. The old view leaves quickly and the new view settles in within 200ms.
- **Accessibility check**: emulate `prefers-reduced-motion: reduce` in DevTools. Navigation must crossfade without vertical movement; stat-card activation must jump directly to its result.
- **Done when**: page transitions are crisp, reduced motion preserves opacity context, and scrolling honors the user preference.
