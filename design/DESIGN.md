# Expense Desk design spec

The agent does the work; the screen only shows what just changed, and the proof is one click away. References and rationale are in `moodboard.html` (v2, revised after the adversarial design review in `review/`).

## Tokens (web/src/index.css)

| Token | Value | Use |
| --- | --- | --- |
| canvas | `#F5F6F8` | App background, queue column |
| surface | `#FFFFFF` | Detail sheet, cards |
| sunken | `#EEF0F3` | Quotes, hovers, tool chips |
| line / line-strong | `#E5E7EB` / `#D1D5DB` | Hairlines; never heavier borders |
| ink / ink-2 / ink-3 | `#16171A` / `#474A52` / `#676A72` | Text. ink-3 is the lightest allowed, never below 12px |
| accent | `#0F6CBD` | Fluent communication blue: live agent activity, focus, Finance edits |
| wait (amber) | `#9A5400` | Needs a human: over the cap, waiting on the manager |
| ok / stop | `#17784A` / `#B3261E` | Approved / rejected only |
| learn | `#0B6A80` + blue→teal gradient | Learned rules. The only gradient in the product |
| teams | `#5B5FC7` | Inside the Teams card preview only |

Type: Instrument Sans for everything, amounts included (26px semibold tabular in the header). JetBrains Mono only for tool chips and IDs. Instrument Serif appears once: the learned-rule sentence. Labels are 12px sentence case, never tracked uppercase.

Shape: 8px radius on rows and inputs, 12px on cards and the detail sheet. Hairline borders, one soft sheet shadow, a stronger float shadow only for popovers and the toast.

## Progressive disclosure

A component appears when the run produces its data and steps back when it stops being useful.

| Moment | Appears | Leaves or quietens |
| --- | --- | --- |
| Idle | Queue of past requests; one-line empty state | Presenter hint (only with `?presenter`) |
| Request arrives | Row slides in and opens itself; sticky header with status and amount; Teams quote and "Read as" facts | Empty state |
| Lookup | Manager chip; job title in the header | — |
| Policy check | Rule rows stream in as arguments arrive; each step shows its tool chip | Details card stays hidden while the agent reads |
| Over the cap | Amber rule row, Teams card preview, "Waiting on Jonas" pill, top bar "Paused · waiting on Jonas", Details card | — |
| Finance edits | Edit step (old → new), "Agent re-checking" then "Synced with agent", re-check step, card refreshed by the agent | Earlier policy check dims as superseded |
| Decision | Green or red decision step with the amount; agent reply | Teams card collapses to one line; fields lock |
| Rule learned | Announcement card with the rule and its evidence, in the request's side column; "1 learned rule" in the top bar glows | The locked Details card steps aside; the announcement leaves when the next request starts |
| Learned approval | Learned rule row and a cited-rule card in the timeline | No approval step at all |

Never on screen: KPI tiles that don't change during the demo, a permanent chat column, blank form fields, raw JSON by default, spinners, the hosting mode.

## Motion

New timeline steps fade up 6px over 280ms. Live steps pulse their dot. Queue rows spring into place. The detail pane scrolls the newest step into view while the agent works. `prefers-reduced-motion` turns all of it off.
