---
name: FUE main-card flex-shrink collapse
description: overflow:hidden on a flex child sets min-height:0, letting it crush to ~0px in a flex column. Fix with flex-shrink:0.
---

## Rule
Any `.pbody` child that has `overflow:hidden` (or `overflow-x/y`) MUST also carry `flex-shrink:0`, otherwise the flex column can crush it to 0px while leaving other siblings at full size.

**Why:** CSS spec — when a flex item has `overflow != visible`, its automatic minimum size becomes 0 instead of its content size. The `.pbody` is `display:flex;flex-direction:column;overflow-y:auto` with a bounded height. Items without `overflow` can't shrink below their content. Items WITH `overflow:hidden` shrink all the way to 0 (or the border/padding box ≈ 2px).

**How to apply:** Whenever you add a card/section as a direct child of `.pbody` that sets any `overflow` shorthand or longhand, add `flex-shrink:0` to that element in the same CSS rule. Applied to `.fue-main-card`, `.fue-kpi-row`, `.fue-bottom-row`.
