# Full test night: report

Run on a phone-sized screen (390x760, 2x) in a real browser, using 20 demo players and 6 past nights, local mode (no real database touched). Repeated in English and Hebrew, light and dark.

## What was run
1. **Stats before the night**: players table, period filters, awards, head to head (one player vs all, and two players).
2. **Setup**: ticked the regulars plus one, checked the "15 here" message, Auto-balance, grouped teams with average grades (Red 5.70 / Blue 5.72).
3. **Game 1**: started the clock, 4:30 in, logged a goal and an assist, then an equaliser, undo bar visible; level at full time; offered and played 2 minutes of extra time; goal in extra time recorded at 9'; saved.
4. **Games 2 and 3**: suggested matchup ("Red won and stays on"), three goals each, saved.
5. **Finish night**: grade changes sheet; stats and head to head updated.
6. **Share card**: drawn, in English and Hebrew.
7. **Hebrew**: setup, game screen, stats table, head to head, settings (light and dark), share card.

## Found and fixed during the run
| Issue | Fix |
|---|---|
| Hebrew share card: each team's colour dot was on the wrong side | dots now follow the reading direction (test added) |
| "1 nights logged", "1 players, 1 nights" in the backup list | proper singular/plural |
| Grade change of 0.0 shown as a green "+0.0" | neutral "0.0" |
| Hebrew "סטטיסטיקות" tab label wrapped onto two lines | shorter label and tighter tab bar for right-to-left |
| "Start" meant two things (timer button and starting grade) | starting-grade label is now "Start grade" |

## Observations (cosmetic, not changed)
- English phone width: the "Head to head" sub-tab wraps onto two lines (all four sub-tabs stay equal height).
- The undo bar covers the lowest player buttons for 7 seconds after a goal (by design; it fades by itself).

## Still needs a real phone
Buzzer sound and vibration, screen wake-lock, installing to the home screen, real signal loss. See `docs/QA-CHECKLIST.md`.
