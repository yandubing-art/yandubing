# 002 - Separate pointer hover from keyboard focus

- **Status**: IMPLEMENTED
- **Commit**: unavailable - this source bundle does not contain `.git`
- **Severity**: HIGH
- **Category**: Accessibility and purpose
- **Estimated scope**: 2 files, CSS-only

## Problem

Hover transforms currently apply on all input types, and stat-card keyboard focus shares the same positional lift as pointer hover.

```css
/* web/styles.css:17 - current */
.stat-card[role="button"]:hover,.stat-card[role="button"]:focus-visible {
  transform:translateY(-2px);
  border-color:currentColor;
  box-shadow:0 14px 30px rgba(28,44,78,.14);
  outline:none;
}

/* web/styles.css:163 - current */
.vehicle-card:hover { transform:translateY(-4px); /* ... */ }
```

On touch hardware this may present a sticky hover state. For a keyboard user, focus should indicate the target without making the reading position jump.

## Target

Keep elevation only on precise-pointer hover. Give keyboard focus a stable, high-contrast outline and shadow with no transform. Use this exact media query:

```css
@media (hover: hover) and (pointer: fine) {
  .button:hover { transform: translateY(-1px); }
  .stat-card[role="button"]:hover { transform: translateY(-2px); }
  .mobile-action:hover { transform: translateY(-2px); }
  .vehicle-card:hover { transform: translateY(-2px); }
  .vehicle-option-chip button:hover { transform: scale(1.05); }
  .theme-toggle:hover { transform: translateY(-1px); }
}

.stat-card[role="button"]:focus-visible {
  transform: none;
  border-color: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 28%, transparent);
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

.button:active { transform: scale(0.97); }
```

Keep non-transform hover colors and shadows inside the same fine-pointer media query. Do not use hover movement on touch devices. The day-theme vehicle-card override must use the same 2px movement as the night/default target.

## Repo conventions to follow

- Existing interactive surfaces already use CSS transitions, so retain that approach.
- The dashboard is operational, not playful: use no bounce and no movement larger than 2px for cards.
- Preserve `web/styles.css:339` focus treatment on the chip delete control; it is already the correct stable-focus pattern.

## Steps

1. Split `.stat-card[role="button"]:hover,.stat-card[role="button"]:focus-visible` in `web/styles.css:17` into distinct selectors.
2. Move every transform-based `:hover` selector from `web/styles.css` into one or more `@media (hover: hover) and (pointer: fine)` blocks near the final precedence CSS. Include `.button`, `.mobile-action`, `.vehicle-card`, `.vehicle-option-chip button`, and `.theme-toggle`.
3. Keep border, background, color, and shadow hover changes with their matching transform rule so touch has no synthetic hover state.
4. Update `web/valueco-day.css:87` to use the same gated vehicle-card hover behavior or remove it in favor of the final shared rule.
5. Add only the `.button:active` press feedback above; do not apply scaling to table rows, form controls, or stat cards.

## Boundaries

- Do not alter click handlers, tab order, focusability, cards' dimensions, or touch target sizes.
- Do not use `outline:none` unless a visible equivalent focus indicator is present.
- Do not add an animation to keyboard-driven task filtering.

## Verification

- **Mechanical**: search `rg -n ':hover.*transform|:hover.*scale' web/styles.css web/valueco-day.css` and confirm each match is protected by the fine-pointer media query.
- **Feel check**: navigate the stat cards with Tab. Focus should remain stationary while clearly visible. On a touch emulator, tapping a card or button must not leave it raised.
- **Reduced motion check**: press a button with reduced motion enabled; the active scale must be removed by the reduced-motion overrides introduced in plan 003.
- **Done when**: pointer hover retains restrained feedback and keyboard/touch use stable feedback.
