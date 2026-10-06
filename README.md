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

## Works on any device

Supervisors can open the link in any current browser on an iPhone, Android phone, iPad, Windows PC, Mac, Chromebook or Linux computer. Phones and browsers back to about 2019 work too.

- **Phone or tablet:** **Open in Messages** opens their texting app with the message filled in.
- **Mac:** it opens Messages, which sends from their iPhone if the two are linked.
- **Windows, Chromebook or Linux:** a computer usually can't send a text from a link, so the form also shows a QR code. They point their phone's camera at it, and the text opens on their phone, ready to send.
- **Copy message** and **Copy number** work everywhere.

## Sharing

Anyone can tap **Share This Calendar** under the title. It shows the link with a **Copy Link** button, the device's own share menu (on phones, tablets and most computers), and a QR code someone can scan with a phone camera.

## Links at the bottom of the page

- **See My Credentials** opens your credentials PDF. It shows only after you upload one in Settings.
- **Report Bugs** opens a short form. Supervisors describe the problem or suggest a fix, tap **Submit Feedback**, and it's emailed to you with their device and browser type. It shows only after you add your email in Settings.
- **Admin Login** is how you get into edit mode.

## What supervisors never see

Your shift times, paid hours, notes (like the site name), and whether a red day is work or something personal. They see the days, the colors, the shift names you'll pick up, your first name, your number and your note at the top.

The public calendar file (`data.json`) holds only that public part. Your times, hours and notes are kept in a private repository variable named `AVAILABILITY_PRIVATE` (**Settings → Secrets and variables → Actions → Variables**). Only you can see it.

## Files

- `index.html`, `app.css`, `app.js`: the site.
- `parser.js`: reads a pasted schedule.
- `credentials.pdf`: your credentials, if you've uploaded them. Settings adds, replaces and removes it.
- `vendor/qrcode.js`: draws the QR code for computers. It's [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT license), kept in the repo so the page never loads code from another site.
- `data.json`: the public calendar. The site rewrites it when you tap **Save**.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

## Connecting a phone or computer for editing

The Admin Login window only shows a link to GitHub's token page and a box for the token, so curious visitors learn nothing. The steps live here:

1. Open GitHub's [fine-grained tokens](https://github.com/settings/personal-access-tokens) page. To make a token: **Generate new token**, name it **Availability calendar**, pick the longest expiration, and under Repository access choose **Only select repositories → Availability**. If you already have one, open it and tap **Regenerate token** to get a new code (GitHub only shows a code once).
2. The token needs two repository permissions, both set to **Read and write**:
   - **Contents** saves the public calendar.
   - **Variables** keeps your hours private.
3. Copy the code (it starts with `github_pat_`), tap **Admin Login** at the bottom of the calendar, paste it and tap **Connect**. The same token works on every device; paste it on each one. Keep a copy in a password manager.
4. If you made your token before Variables was needed, the site asks you to add it. Go to GitHub → Settings → Developer settings → Fine-grained tokens → **Availability calendar** → **Edit**, and set **Variables** to **Read and write**. You don't need to paste the token again.

## Adding your schedule

Tap **Add Schedule** and type one line per day, for every day you can see in LISA:

```
Fri 10/9 2300-0700 "Site B"
Sat 10/10 2300-0700 "Site B"
Sun 10/11 no shift
Mon 10/12 2200-0600 "Site C, Gate 2"
Tue 10/13 no shift
Wed 10/14 busy
Thu 10/15 2300-0700
```

- **Day name (optional), date, then what the day is.** The day name is checked against the date, so a typo like "Tue 10/7" (10/7 is a Wednesday) gets flagged. Without a year, the nearest year is used, so in January, 12/30 means the December just past.
- **Working:** the shift in 24-hour time, start-end: `2300-0700`. A shift that ends after midnight goes on the day it starts. Paid hours come from the times. If a break isn't paid, add the paid hours: `2300-0730 8h`. 23:00-07:00 and 11pm-7am also work. A time that could be morning or night, like "11-7", gets flagged.
- **Not scheduled:** `no shift`. The day turns green, or yellow if one more shift would mean overtime.
- **Don't want to work:** `busy` (red). A bare `off` is flagged, because it could mean either.
- **Back to gray:** `clear`.
- **Notes go in quotes:** `2300-0700 "Site B"`. Anything in quotes is a private note and is never read as a time, hours, or a word like open, clear or covered. Straight or curly quotes both work. To quote something inside a note, use single quotes: `"Sgt said 'call me'"`. Notes are optional. Any word outside quotes that the site doesn't recognize is flagged instead of guessed.
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

The site shows a preview before anything changes. Lines it can't read are listed with the reason, and they stay in the box after you add the rest, so you can fix them. If your list leaves gray days in between, you can choose to mark them Available. Days from a line that couldn't be read are never filled in. Tap **Add to Calendar**, check the days, then tap **Save**.

## Editing single days

Pick what a tap does in the toolbar:
- **Working**, **Busy** or **Available**: tap a day to mark it. Tap it again to turn it back to gray.
- **Tap to Edit**: opens the day. You can set start and end times, paid hours, a private note, or which shifts you'd take.

**See What Supervisors See** previews the public page. **Save** publishes your changes, and supervisors see them within a minute or two.

Changes you haven't saved stay on that device, even if the tab closes. They come back the next time you open the site. If you saved from another device in the meantime, only the days you changed are put back. Everything else comes from the newer save. If two devices save at nearly the same moment, the site asks what to do. **Add My Changes to It** keeps both, and your change wins on any day you both edited. **Load the Newer One** drops what you changed on this device.

## Settings

- **Every Week:** check the days you work (or are busy) every single week. They show red every week until you uncheck them. For a day you work, you can add the start and end times and paid hours, so they count toward overtime and the yellow days stay right. To change just one date, like a holiday, tap that day on the calendar (or paste it in Add Schedule). Picking **Every Week** in that day's editor puts it back. Adding, changing or turning off a day counts from today: days already past in this pay week keep what they were, and a day you turn off still counts today. On your calendar, these days show a small ↻. Supervisors just see red.
- The shifts you'll usually pick up. Supervisors see the names only.
- Your name (shown at the top, and the first name is used in texts), your **employee ID** (shown under the color key), your cell number, and an optional note. Changing your name changes it in both places. Supervisors see it after you tap **Save**.
- **Credentials PDF:** **Upload PDF**, **Replace PDF** or **Remove PDF**. These happen right away, without tapping Save. Supervisors see the change within a minute or two. The limit is 20 MB.
- **Email for bug reports:** where Report Bugs messages go. They're forwarded by [FormSubmit](https://formsubmit.co), a free service with no account. The first message to a new address sends you an email from FormSubmit; open it and tap **Activate Form**, or nothing arrives. Tap **Send a Test** to do that right away. Reports sent before you activate are delivered once you do. Like everything in Settings except the PDF, the address reaches supervisors when you tap **Save**.
- **Pay week ends** sets the day your pay week ends at midnight (Thursday for you). Hours are counted by the clock: a Thursday 2300-0700 shift counts 1 hour toward that week and 7 toward the next.
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide when a green day turns yellow. A day turns yellow when one more usual-length shift would go past 40 in its pay week. On the last day of a pay week, an overnight pickup also counts toward the next week, since most of it is paid there.

## Privacy notes

- Anyone with the link can see your name, employee ID, cell number, calendar colors and credentials PDF. The page tells search engines not to list it.
- Your bug-report email is in the public calendar file, because supervisors' browsers send reports to it, and a saved address stays in the file's history even if you change it later. To keep it private, tap **Send a Test**, activate, and paste the random code FormSubmit emails you in place of your email before you tap **Save**.
- After you publish a new version of the site, reload any calendar tab you left open on your phone or computer before editing there. An old tab doesn't know about newer settings.
- A replaced or removed credentials PDF stays in the repository's history on GitHub, so anyone who looks there can still find older versions.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop Editing on This Device**, or delete the token on GitHub.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
