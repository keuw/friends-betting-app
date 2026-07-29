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
- Large collection pickers stay height-bounded, begin with search and a small
  result batch, and keep selected items visible outside the scrolling region.
- Public ledgers pair free-text search with pressed-state status filters, keep
  filtered and total counts visible, and offer a one-action reset when no
  records match.
- The matched-bet ledger opens on `Current`: pending and resolved bets remain
  visible while mutually voided history is hidden until requested. Pending,
  Resolved, Voided, and All remain explicit counted filters.
- The `My live bets` score-strip metric is a compact drill-down action, not a
  static KPI. It opens the matched-bet ledger on the counted `My live` filter:
  only pending bets where the viewer is a participant. The normal Matched bets
  destination always returns to `Current`, and the other two score metrics stay
  noninteractive.
- Maker-won and taker-won are both user-facing Resolved bets while each card
  retains its exact winner badge. Offline pair-balance payments are not
  presented as a per-bet Settled state.
- Voided bets are filtered, never erased. Selecting Voided or All restores the
  complete agreement, reason, revisions, and public history.
- Numbered revision badges identify the exact terms used by each offer and bet.
  Revision timelines are append-only and show author, timestamp, change note,
  status, and the meaningful before/after fields.
- A proposed matched-bet revision always appears beside the still-active terms
  in an explicit old-versus-new comparison. Acceptance and rejection are
  visually distinct, and the interface states that nothing changes before the
  other participant accepts.
- Every acceptance surface names the viewer's exact outcome or Back/Fade
  position and states what must happen for that viewer to win. Internal
  maker/taker roles never substitute for a meaningful user-facing side.
- Offer and matched-bet legs show context from their captured market revision,
  not the market's latest version. Parlay cards label selections as listed
  picks and explain that Fade wins when any listed pick misses; Fade is never
  presented as reversing every leg.
- A participant's matched-bet card uses an in-flow `YOUR BET` summary for their
  side, winning condition, opponent, and maximum risk. Observers receive a
  neutral two-party explanation instead of personalized language.

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
