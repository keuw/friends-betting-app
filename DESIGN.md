# Sidebet Design System

Sidebet feels like a well-kept betting slip passed around a group chat: direct,
social, slightly irreverent, and trustworthy enough to settle an argument.

## Surface modes

- The anonymous landing page is **Persuade**. It may use oversized editorial
  type, paper texture, offset composition, and expressive shadows.
- The signed-in application is **Operate**. It keeps the same ink, cream, and
  receipt details, but prioritizes scanability, clear state, and fast actions.
- Product behavior, odds, maximum-loss language, and offline-payment boundaries
  always outrank decoration.

## Color roles

- `ink` — primary text, decisive actions, navigation, and strong borders.
- `cream` — page canvas and quiet grouped surfaces.
- `paper` — cards, forms, and foreground surfaces.
- `acid` — primary action, open/pending state, and positive confirmation.
- `blue` — selected propositions and informational emphasis.
- `coral` — attention, debt, destructive state, or editorial accent.
- Muted text must be tinted from the surrounding surface and remain readable;
  gray is not placed indiscriminately on colored surfaces.

## Typography

- Geist Sans carries product copy and controls.
- Geist Mono is reserved for odds, money, timestamps, counts, and compact
  ledger labels.
- Georgia italic is an editorial accent, not a body typeface.
- Display text never exceeds `6rem` and negative tracking stops at `-0.04em`.
- Body copy stays near 65–75 characters where a continuous reading measure
  exists.
- Money uses tabular figures.

## Layout and spacing

- The content maximum is `1400px`; page gutters are `1.25rem` minimum.
- Related controls use tight `0.5–0.75rem` gaps. Separate workflows use
  `1.5–3rem`.
- Application cards use `12–16px` radii. Pills are reserved for counts, status,
  and user identity.
- Task surfaces use one elevation signal: border or shadow, not both.
- Landing-page paper props are an explicit exception and may use an offset
  editorial shadow.

## Components and state

- Every actionable control is at least `44px` high on touch layouts.
- Every link, button, input, and textarea has a visible `:focus-visible` state.
- Primary buttons name the result: “Post offer,” “Take the other side,”
  “Confirm received.”
- Disabled state reduces contrast without hiding the control.
- Loading, empty, error, success, and permission-limited states stay in the
  normal flow and explain the next useful action.
- Open/pending uses acid, resolved/confirmed uses blue, and
  rejected/cancelled/void uses coral-tinted red.

## Responsive behavior

- At wide widths, creation tools may remain sticky beside the public ledger.
- Below `1020px`, workflows stack and sticky side panels return to normal flow.
- Below `680px`, the four primary destinations move to a fixed bottom task bar.
- Long names and market questions wrap; badges and money never force the card
  wider than the viewport.

## Motion

- Motion communicates press, hover, disclosure, or loading—never decoration
  alone.
- Transitions stay between `140–220ms` and use transform, color, border, or
  shadow without causing layout shift.
- `prefers-reduced-motion` removes nonessential animation.

## Product boundaries

- Sidebet never suggests it holds, moves, or verifies money.
- All monetary labels describe agreed maximum loss or an offline debt record.
- The interface does not imply that a wager or debt is legally enforceable.
