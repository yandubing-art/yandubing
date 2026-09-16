# Animation Plans

| # | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Consolidate motion tokens and explicit transitions | HIGH | IMPLEMENTED |
| 002 | Separate pointer hover from keyboard focus | HIGH | IMPLEMENTED |
| 003 | Make navigation and scrolling motion-aware | HIGH | IMPLEMENTED |
| 004 | Add restrained booking-decision confirmation feedback | LOW | IMPLEMENTED |
| 005 | Add lightweight timeline refresh feedback | LOW | IMPLEMENTED |

## Recommended execution order

1. `001-motion-tokens-and-explicit-transitions.md`
2. `002-pointer-and-keyboard-motion.md`
3. `003-view-transitions-and-reduced-motion.md`
4. `004-booking-decision-feedback.md`
5. `005-timeline-filter-feedback.md`

## Dependencies

- Plan 002 uses the shared duration tokens from plan 001.
- Plan 003 uses the shared easing and duration tokens from plan 001 and owns the `prefersReducedMotion()` helper.
- Plan 004 depends on plan 003 for `prefersReducedMotion()`.
- Plan 005 can be executed after plan 004 or independently with the same animation-cancellation pattern.

## Scope

These are local UI-motion plans only. They must not change ports, reverse proxies, authentication, Lark permissions, API behavior, PM2 configuration, or production deployment.
