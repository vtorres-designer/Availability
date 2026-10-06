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

When a supervisor taps a green or yellow day, they get one button for each type of shift you'll pick up (Overnight, Swing, Morning). The button opens their texting app with a message already written, for example:

> Hi Vincent, it's Maria. Can you cover an overnight shift on the night of Tue, Oct 13?

They add the site and times, then hit send. The text comes from their own number, so you can reply to them directly.

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

Tap **Add schedule** and paste one line per day or date range:

```
10/7 2300-0700
10/8 11pm-7am Site B
10/9, 10/10 2300-0700
10/12-10/14 off
Oct 20-24 open
Oct 25 open overnight swing
10/26 work 8h
10/27 clear
```

- **Date first:** 10/7, Oct 7, 2026-10-07, a range (10/12-10/14) or a list (10/9, 10/10). Without a year, it picks the nearest one, so in January, 12/30 means the December just past.
- **Day names:** before a date, they're checked against it ("Tue 10/7" is flagged if 10/7 is a Wednesday). After a range, they pick days from it: `10/12-10/25 Mon Wed Fri 2300-0700`. You can also use *weekdays* or *weekends*.
- **Times mean you're working:** 2300-0700, 23:00-07:00, or 11pm-7am. Paid hours are worked out from the times. If a time could be morning or night, like "11-7" or "11:00-7:00", the site asks you to add am/pm. Put one shift on each line.
- **Or use one word:**
  - *off* or *busy* turns the day red.
  - *open* turns it green.
  - *work* turns it red and counts your usual shift length.
  - *clear* turns it back to gray.
- **Extras:** *8h* sets the paid hours, for example when a meal break isn't paid. After *open*, add *overnight*, *swing* or *morning* to limit the shifts you'll take that day.
- **Unclear lines aren't guessed.** For example, "not available" or a time that could be AM or PM gets flagged, so you can reword it.
- **Anything else** on the line, like the site name, is saved as a private note.
- If two lines cover the same day, the lower one wins.

The site shows a preview before anything changes. Lines it can't read are listed with the reason, and they stay in the box after you add the rest, so you can fix them. If your list leaves gray days in between, you can choose to mark them Available. Days from a line that couldn't be read are never filled in. Tap **Add to calendar**, check the days, then tap **Save**.

## Editing single days

Pick what a tap does in the toolbar:
- **Working**, **Busy** or **Available**: tap a day to mark it. Tap it again to turn it back to gray.
- **Tap to edit**: opens the day. You can set start and end times, paid hours, a private note, or which shifts you'd take.

**See what supervisors see** previews the public page. **Save** publishes your changes, and supervisors see them within a minute or two.

## Settings

- The shifts you'll usually pick up. Supervisors see the names only.
- Your first name, your cell number, and an optional note shown at the top.
- **Pay week starts** sets which day each week begins. Match it to your paycheck so overtime is counted against the right week.
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide when a green day turns yellow.

## Privacy notes

- Anyone with the link can see your first name, cell number and calendar colors. The page tells search engines not to list it.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop editing on this device**, or delete the token on GitHub.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
