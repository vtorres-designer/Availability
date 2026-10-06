# Shift Availability

A one-page calendar you text to supervisors. They open the link, see which days you can cover, and tap a day to text you. It's free: GitHub Pages hosts it, and texts go from the supervisor's own phone.

Live at <https://vtorres-designer.github.io/Availability/>. The capital A matters: the link has to match the repo name exactly.

| Color | Meaning |
|---|---|
| Green **OPEN** | Available. |
| Yellow **OT** | Available, but one more shift would push that pay week past 40 hours. |
| Red **BUSY** | Not available, because you're working or you blocked the day. Supervisors can't tell which. |
| Gray | Not set yet. Every day starts gray until you mark it. |

A night shift is listed under the day it starts. Tue means Tue night into Wed morning.

When a supervisor taps a green or yellow day, they get a short form. Every box is optional: their name, the shift type, the shift time (2300-0700 or 11:00PM to 7:00AM), the site name and the site address. Each box they fill in adds a sentence to the text:

> Hi Vincent. This is Sarah. Are you available to cover an overnight shift on the night of Tuesday, Oct 13, from 2300 to 0700? It's at Site B, 123 Main St. Let me know. Thanks!

They can edit the message before tapping **Open in Messages**. The text comes from their own number, so you can reply to them directly. Their phone remembers their name, site and address for next time.

## What supervisors never see

Your shift times, paid hours, notes (like the site name), and whether a red day is work or something personal. They see the days, the colors, the shift names you'll pick up, your first name, your number and your note at the top.

The public calendar file (`data.json`) holds only that public part. Your times, hours and notes are kept in a private repository variable named `AVAILABILITY_PRIVATE` (**Settings → Secrets and variables → Actions → Variables**). Only you can see it.

## Files

- `index.html`, `app.css`, `app.js`: the site.
- `parser.js`: reads a pasted schedule.
- `data.json`: the public calendar. The site rewrites it when you tap **Save**.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

## Connecting a phone or computer for editing

1. Open the site, tap **Vincent? Edit calendar** at the bottom, and follow the steps on screen.
2. The GitHub token needs two repository permissions, both set to **Read and write**:
   - **Contents** saves the public calendar.
   - **Variables** keeps your hours private.
3. If you made your token before Variables was needed, the site asks you to add it. Go to GitHub → Settings → Developer settings → Fine-grained tokens → **Availability calendar** → **Edit**, and set **Variables** to **Read and write**. You don't need to paste the token again.

## Adding your schedule

Tap **Add schedule** and type one line per day, for every day you can see in LISA:

```
Fri 10/9 2300-0700 Site B
Sat 10/10 2300-0700 Site B
Sun 10/11 no shift
Mon 10/12 2200-0600 Site C
Tue 10/13 no shift
Wed 10/14 busy
Thu 10/15 2300-0700 Site B
```

- **Day name (optional), date, then what the day is.** The day name is checked against the date, so a typo like "Tue 10/7" (10/7 is a Wednesday) gets flagged. Without a year, the nearest year is used, so in January, 12/30 means the December just past.
- **Working:** the shift in 24-hour time, start-end: `2300-0700`. A shift that ends after midnight goes on the day it starts. Paid hours come from the times. If a break isn't paid, add the paid hours at the end: `2300-0730 8h`. 23:00-07:00 and 11pm-7am also work. A time that could be morning or night, like "11-7", gets flagged.
- **Not scheduled:** `no shift`. The day turns green, or yellow if one more shift would mean overtime.
- **Don't want to work:** `busy` (red). A bare `off` is flagged, because it could mean either.
- **Back to gray:** `clear`.
- **Notes:** anything after the times, like the site, is a private note.
- **Shortcuts:** a range (`10/12-10/14 no shift`), a list (`10/9, 10/10 2300-0700`), or day names right after a range (`10/12-10/25 Mon-Fri 2300-0700`, *M/W/F*, *TTh*, *weekdays*, *weekends*). Day names anywhere else on a range line get flagged, so a site like "Sun Valley Mall" never filters days by accident. After `no shift`, you can add *overnight*, *swing* or *morning* to limit the shifts you'd take that day.
- **Unclear lines aren't guessed.** These get flagged so you can reword them:
  - "not available" or "except Sat"
  - a time that could be AM or PM
  - two shifts on one line
  - "off" on its own, or written after the times
  - a cancelled shift
  - a number that could be a date or part of a site name
- **Anything else** on the line, like the site name, is saved as a private note.
- If two lines cover the same day, the lower one wins.

The site shows a preview before anything changes. Lines it can't read are listed with the reason, and they stay in the box after you add the rest, so you can fix them. If your list leaves gray days in between, you can choose to mark them Available. Days from a line that couldn't be read are never filled in. Tap **Add to calendar**, check the days, then tap **Save**.

## Editing single days

Pick what a tap does in the toolbar:
- **Working**, **Busy** or **Available**: tap a day to mark it. Tap it again to turn it back to gray.
- **Tap to edit**: opens the day. You can set start and end times, paid hours, a private note, or which shifts you'd take.

**See what supervisors see** previews the public page. **Save** publishes your changes, and supervisors see them within a minute or two.

Changes you haven't saved stay on that device, even if the tab closes. They come back the next time you open the site. If you saved from another device in the meantime, only the days you changed are put back. Everything else comes from the newer save. If two devices save at nearly the same moment, the site asks what to do. **Add my changes to it** keeps both, and your change wins on any day you both edited. **Load the newer one** drops what you changed on this device.

## Settings

- The shifts you'll usually pick up. Supervisors see the names only.
- Your name (shown at the top, and the first name is used in texts), your **employee ID** (shown under your name), your cell number, and an optional note.
- **Pay week ends** sets the day your pay week ends at midnight (Thursday for you). Hours are counted by the clock: a Thursday 2300-0700 shift counts 1 hour toward that week and 7 toward the next.
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide when a green day turns yellow. A day turns yellow when one more usual-length shift would go past 40 in its pay week. On the last day of a pay week, an overnight pickup also counts toward the next week, since most of it is paid there.

## Privacy notes

- Anyone with the link can see your first name, cell number and calendar colors. The page tells search engines not to list it.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop editing on this device**, or delete the token on GitHub.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
