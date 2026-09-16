# 001 - Consolidate motion tokens and explicit transitions

- **Status**: IMPLEMENTED
- **Commit**: unavailable - this source bundle does not contain `.git`
- **Severity**: HIGH
- **Category**: Performance and cohesion
- **Estimated scope**: 1 file, CSS-only

## Problem

`web/styles.css:15` and the duplicate theme-toggle rules at `web/styles.css:405` and `web/styles.css:1920` use shorthand transitions. In CSS, `transition: .18s ease` applies to every property, including properties that should not be animated on a dense operations screen.

```css
/* web/styles.css:15 - current */
.button { border:0; border-radius:11px; padding:11px 16px; font-weight:700; transition:.18s ease; }

/* web/styles.css:405 - current */
.theme-toggle { /* ... */ transition:.18s ease; }
```

## Target

Add a small shared motion scale to the existing `:root`, then transition only composited or deliberate visual properties. Use the exact values below.

```css
:root {
  --motion-press: 140ms;
  --motion-hover: 160ms;
  --motion-view: 200ms;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}

.button {
  transition:
    transform var(--motion-press) ease,
    background-color var(--motion-hover) ease,
    border-color var(--motion-hover) ease,
    box-shadow var(--motion-hover) ease,
    color var(--motion-hover) ease,
    opacity var(--motion-hover) ease;
}

.theme-toggle {
  transition:
    transform var(--motion-press) ease,
    background-color var(--motion-hover) ease,
    border-color var(--motion-hover) ease,
    color var(--motion-hover) ease;
}
```

For `.stat-card`, `.mobile-action`, `.vehicle-card`, `.task-row > td`, and `.vehicle-option-chip button`, replace hand-written `150ms`/`180ms`/`200ms` values with the relevant token. Do not animate layout, filter, blur, width, height, margin, or padding.

## Repo conventions to follow

- The interface is plain CSS and plain JavaScript. Do not add a motion library.
- Append effective overrides to the final precedence section of `web/styles.css`; the file deliberately contains earlier legacy layers.
- Preserve `web/styles.css:2161-2190`, which contains the existing scroll-performance safeguards.

## Steps

1. In `web/styles.css:1`, append the five target custom properties to the existing `:root` declaration.
2. Replace the `.button` shorthand at `web/styles.css:15` with the target explicit property list. Retain all existing geometry and colors.
3. Replace both `.theme-toggle` shorthand declarations (`web/styles.css:405` and `web/styles.css:1920`) with the target explicit property list, or consolidate them in the final precedence block while preserving current theme colors.
4. Convert existing short hover transitions to `var(--motion-hover)` and `var(--motion-press)` without broadening their property lists.
5. Confirm with a repository search that no `transition: all` or bare `transition: .` shorthand remains in `web/styles.css`.

## Boundaries

- Do not change markup, colors, sizing, page hierarchy, backdrop filters, or the current visual identity.
- Do not modify `web/valueco-day.css` unless its vehicle-card override needs the shared duration token.
- Do not add JavaScript, dependencies, build artifacts, or deploy changes.

## Verification

- **Mechanical**: run `rg -n 'transition:\s*(all|\.[0-9])' web/styles.css`; it should return no broad shorthand transitions.
- **Feel check**: hover buttons, the theme control, and vehicle cards rapidly. Their colors and elevation should retarget smoothly without delayed or muddy transitions.
- **Performance check**: use Chrome DevTools Performance while scrolling the dashboard; confirm no transition attempts to animate layout properties.
- **Done when**: every changed interaction uses only its stated properties and the shared timing scale.
