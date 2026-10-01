# Manual QA checklist

Things the automated tests can't judge. Run this on a **real phone** before a big change goes to the group, and after any update to the timer, sharing, or install flow. Tick each line; note the phone and browser.

Phone: ____________  Browser: ____________  Date: ____________  App version/commit: ____________

## 1. Install and first open
- [ ] Open the site link. The sign-in screen shows (group name + password), no data visible.
- [ ] Android Chrome: an "Install" prompt/banner appears, or menu → **Add to Home Screen** works. iPhone Safari: the hint says Share → Add to Home Screen, and the icon is the green football.
- [ ] Opened from the home-screen icon, the app is full-screen (no browser bar) and the name under the icon is "MN Football".
- [ ] Wrong password → "Group name or password is not right". Correct admin password → five tabs. Viewer password → three tabs and no edit buttons.

## 2. Setting up a night (at home, before the game)
- [ ] Regulars are at the top; "Tick all regulars" works; untick the ones who aren't coming.
- [ ] With the wrong number of players, Start/Auto-balance are greyed and the message says how many to add/remove.
- [ ] With exactly 15: Auto-balance gives three teams of 5 whose average grades are within ~0.5. Tap **Auto-balance** again: different teams, still fair.
- [ ] Moving a player to another colour updates both teams' averages.
- [ ] (Subs on) 16–17 players: the extras show as Bench and can be swapped in during a game.

## 3. During a game (one hand, outdoors)
- [ ] Buttons are big enough to hit reliably with a thumb; the screen does not zoom or jump when tapping.
- [ ] Timer: Start, Pause, Resume, Reset behave. Lock the phone for 1 minute and unlock: the clock is still right.
- [ ] The screen stays on while the clock is running.
- [ ] At full time the phone **buzzes/beeps** (sound on) and stays silent when "Sound & vibration" is off in Settings.
- [ ] Tied at full time: "+ 2 min extra time" is offered; not offered when someone is ahead.
- [ ] Log a goal: the "Undo" bar appears for ~7 seconds and really removes that goal. Goal minute shows next to the goal; tapping it lets you edit the minute.
- [ ] Wrong scorer by mistake: delete the goal with ✕ and add the right one.
- [ ] "Save game" returns to the night and shows ✓. The suggested next game makes sense (winner stays on).
- [ ] (Subs on) Substitute button: the right player comes off, a bench player goes on, and the sub can score.

## 4. End of the night
- [ ] "Finish night & update grades" shows who went up/down. Grades in Stats match.
- [ ] **Share result card** opens the phone's share sheet (or downloads a PNG). The picture is readable: scores, scorers, star of the night, no cut-off text.
- [ ] Stats → Awards shows sensible winners; Past nights lists the night; Reopen works if you need to fix something.

## 5. Shared data (use two phones)
- [ ] Phone A (admin) logs a goal; phone B (viewer, Tonight tab) shows it within ~20 seconds, with the minute.
- [ ] Viewer cannot edit anything and has no Players/Settings tabs.
- [ ] Two admins editing at once: the second save warns that newer data was loaded.
- [ ] Settings → Rename group: friends need the new name; the old name stops working.
- [ ] Settings → Change passwords: the old viewer password stops working.

## 6. Safety nets
- [ ] Settings → Automatic backups lists "After night …" after finishing a night. **Back up now** adds one.
- [ ] Delete a player (test group only!): a "Before deleting …" backup appears; Restore brings the player back.
- [ ] Airplane mode: the app still opens with the last data and says "Offline"; log a goal; turn airplane mode off — the header changes to "Saved ✓" within ~10 seconds and a second phone sees the goal.
- [ ] Five wrong passwords in a row show no lock; after 10 within 10 minutes the sign-in says "Too many wrong attempts" (try only on a test group).

## 7. Look and feel
- [ ] Light mode and dark mode both readable (switch the phone setting).
- [ ] Rotate the phone: nothing is cut off.
- [ ] Big player list (20 players): scrolls smoothly; the bottom tab bar never hides content.
- [ ] Text is readable without zooming.

## Result
- [ ] All passed  - [ ] Issues found (list below):
