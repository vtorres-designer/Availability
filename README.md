# Shift Availability

A one-page calendar you text to supervisors. They open the link, see which days you can cover, and tap a day to text you. It's free: GitHub Pages hosts it, and texts go from the supervisor's own phone.

Live at <https://vtorres-designer.github.io/Availability/>. The capital A matters: the link has to match the repo name exactly.

| Color | Meaning |
|---|---|
| Green **OPEN** | Available. |
| Half yellow, half green **P-OT** | Available, but part of one more shift would be overtime. The day is split corner to corner, top left to bottom right. The color key on the page lists only the four plain colors; the split speaks for itself. |
| Yellow **OT** | Available, but all of one more shift would be overtime (that pay week is already at 40 hours). |
| Red **BUSY** | Not available, because you're working or you blocked the day. Supervisors can't tell which. |
| Gray | Not set yet. Every day starts gray until you mark it. |

A night shift is listed under the day it starts. Tue means Tue night into Wed morning. While **Overnight** is checked under the shifts you'll pick up (Settings), the page says this right under **Shifts I'll Pick Up**, starting with \*\* like a footnote; uncheck Overnight and it goes away. Your own note to supervisors goes on that same line, after it (or alone, in the same small grey text, when Overnight is off).

When a supervisor taps a green or yellow day, they're first asked **Which shift do you need covered?** (Morning, Swing or Overnight). A shift you don't take gets a short reply, like "Sorry, I'm not accepting Morning shifts right now." A shift you take (from Settings, or a day's own list) opens a short form: Your Name, Shift Time (the grey example inside the box reads "2300-0700" or "11:00PM-7:00AM"), Site Name, Site Address and Pay Rate. Each label ends in "(optional)", and each box they fill in adds a sentence to the text:

> Hi Vincent. This is Sarah. Are you available to cover an overnight shift on the night of Tuesday, Oct 13, from 2300 to 0700? It's at Site B, 123 Main St. The pay is $22/hr. Let me know. Thanks!

The wording fits the shift: "on the night of" for overnight, "on the day of" for morning, "on the evening of" for swing.

When some of the shift would be overtime for you, the text ends with how much: "You'd get overtime pay for 5 of the 8 hours of this shift." or "You'd get overtime pay for all 8 hours of this shift." The count follows the shift time the supervisor types, and the line at the top of the window changes with it ("I'm available, but 2 of the 8 hours would be overtime"). Until they type a time the site can read, it counts your usual shift length (for an 8-hour shift: a morning is 7 AM to 3 PM, a swing 3 PM to 11 PM, an overnight 11 PM to 7 AM), and if only part of it would be overtime the top line says "some of the 8 hours" instead of a number. On the last day of a pay week, a shift is split at midnight between the two weeks: if this week is full, a 10 PM start gives 2 overtime hours and an 11 PM start gives 1. So one shift that day can be overtime when another isn't. The day's color shows the shift with the most overtime, and the window says which shift is which.

### P-OT days

A P-OT day (half yellow, half green) works differently, because there the shift's times decide everything. The window has the same top ("Wednesday, October 7", then "I'm available, but part of the shift would be overtime"), and instead of the shift buttons it says "Let's work out how many hours of the shift you need covered would be overtime." and asks **When does the shift start?** and **When does the shift end?**, each a box for the time ("11", "1130" or "11:30") with **AM** and **PM** buttons. A 24-hour time like 2300 picks PM by itself.

Once both times are in, a bar shows the shift hour by hour: one block per hour, labeled with the hour it starts (11 PM, 12 AM, 1 AM…), green for regular hours and yellow for overtime, with a line under it like "8 hours: 3 regular, 5 overtime." A block where overtime starts partway through the hour is split, and a last half hour is a half-width block. The top line gives the number ("5 of the 8 hours would be overtime").

Then they pick **Yes, Let's Do It**, which opens the message form with Shift Time filled in ("11:00PM-7:00AM") and the overtime hours at the end of the text, or **Pick Another Day**, which goes back to the calendar. On the form, **Change Times** goes back to the bar with their times kept. The message says "a shift on the night of…", "on the evening of…" or "on the day of…" depending on the start time (from 7 PM, from 3 PM, from 5 AM).

Your **P-OT Shifts** settings decide what you'll take on those days:
- **Start times I'll accept**, like `1900-0300`. A range can run past midnight; then a start after midnight (like 1 AM) means the next morning. A start outside the range gets "Sorry, I can only start a shift between 7 PM and 3 AM that day."
- **Longest shift**, like 10 hours. A longer one gets "Sorry, I can't take a shift longer than 10 hours that day."

Either box can be left empty for no limit. A shift you'd turn down shows no bar and no Yes button, and if a supervisor changes the Shift Time on the form to one you'd turn down, the top line says why and the send buttons turn off. Supervisors can see these two settings, since their page does the checking; they say what you'd accept, not when you work.

### On a laptop

On a wide screen (a laptop, or a tablet turned sideways) the message form sits side by side: the boxes on the left, and the message, the send buttons and the QR code on the right, so the message updates in view as they type and nothing needs scrolling.

They can edit the message, then pick one of three matching buttons under **Send to** your number: **Open in Messages**, **Copy Message** or **Copy Number**. On a computer, a QR code sits beside them. The text comes from their own number, so you can reply to them directly. Their phone remembers their name, site, address and pay rate for next time.

## Works on any device

Supervisors can open the link in any current browser on an iPhone, Android phone, iPad, Windows PC, Mac, Chromebook or Linux computer. Phones and browsers back to about 2019 work too.

- **Phone or tablet:** **Open in Messages** opens their texting app with the message filled in.
- **Mac:** it opens Messages, which sends from their iPhone if the two are linked.
- **Windows, Chromebook or Linux:** a computer usually can't send a text from a link, so the form also shows a QR code beside the buttons. They point their phone's camera at it, and the text opens on their phone, ready to send.
- **Copy Message** and **Copy Number** work everywhere.

## Sharing

Anyone can tap **Share This Calendar** at the bottom of the page, next to **See My Credentials**. It shows the link with a **Copy Link** button, the device's own share menu (on phones, tablets and most computers), and a QR code someone can scan with a phone camera.

## Links at the bottom of the page

- **See My Credentials** opens your credentials PDF. It shows only after you upload one in Settings.
- **Share This Calendar** shows the link to copy or share (see Sharing above).
- **Report Bugs** opens a short form. Supervisors describe the problem or suggest a fix, tap **Submit Feedback**, and it's emailed to you with their device and browser type. It shows only after you add your email in Settings.
- **Admin Login** is how you get into edit mode.
- Your **employee ID**, if you set one, is in small grey text under these links.

## What supervisors never see

The page never shows your shift times, the hours of any one day, notes (like the site name), or whether a red day is work or something personal. It shows the days, the colors, the shift names you'll pick up, your P-OT start times and longest shift, your first name, your number, your note under the shifts, and when you last saved.

To count overtime hours from whatever shift time a supervisor types, the public calendar file also has your usual shift length and, for each pay week within one usual shift of overtime, how many hours you have left before it. Weeks further from overtime aren't listed. From those numbers someone could work out your weekly total ("2 hours left, so he's at 38"), which you're fine with. GitHub keeps every older copy of the file, so comparing two copies can also show how many hours a newly red day added.

Your shift times are never in the page or the file, and the numbers can't be used to work them out. A shift on the last day of the pay week is split at midnight between two weeks, and a real split would give away the start time (1.5 hours before midnight means 10:30 PM). So in the public count, every shift that runs past midnight is taken to end at 7 AM, whatever its real times. For an 11 PM to 7 AM shift, that's exact. For others, the overtime count near the end of a pay week can be off by the difference. Your own hour totals in edit mode still use your real times.

A shorter shift than your usual one is always counted right. A longer one typed into a week that isn't listed (one with room for a full usual shift) is counted as no overtime.

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
- **Not scheduled:** `no shift`. The day turns green, or P-OT or yellow if one more shift would mean overtime.
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

- **Every Week:** check the days you work (or are busy) every single week. They show red every week until you uncheck them. For a day you work, you can add the start and end times and paid hours, so they count toward overtime and the yellow and P-OT days stay right. To change just one date, like a holiday, tap that day on the calendar (or paste it in Add Schedule). Picking **Every Week** in that day's editor puts it back. Adding, changing or turning off a day counts from today: days already past in this pay week keep what they were, and a day you turn off still counts today. On your calendar, these days show a small ↻. Supervisors just see red.
- The shifts you'll usually pick up. Supervisors see the names only.
- Your name (shown at the top, and the first name is used in texts), your **employee ID** (shown in small grey text at the very bottom, above the time you last saved), your cell number, and an optional note (shown under the shifts you'll pick up). Changing your name changes it in both places. Supervisors see it after you tap **Save**.
- **Credentials PDF:** **Upload PDF**, **Replace PDF** or **Remove PDF**. These happen right away, without tapping Save. Supervisors see the change within a minute or two. The limit is 20 MB.
- **Email for bug reports:** where Report Bugs messages go. They're forwarded by [FormSubmit](https://formsubmit.co), a free service with no account. The first message to a new address sends you an email from FormSubmit; open it and tap **Activate Form**, or nothing arrives. Tap **Send a Test** to do that right away. Reports sent before you activate are delivered once you do. Like everything in Settings except the PDF, the address reaches supervisors when you tap **Save**.
- **Pay week ends** sets the day your pay week ends at midnight (Thursday for you). Hours are counted by the clock: a Thursday 2300-0700 shift counts 1 hour toward that week and 7 toward the next.
- **P-OT Shifts:** the start times and longest shift you'd take on a P-OT day (see P-OT days above).
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide the colors. A day is green when one more usual-length shift keeps its pay week at 40 or less, P-OT when only part of that shift would go past 40, and yellow when all of it would. On the last day of a pay week, an overnight pickup is split at midnight, with most of it counted in the next week.
- After you publish a new version of the site with a new public setting (like the hours left before overtime), opening edit mode shows **Save 1 Change**. Tap **Save** once so supervisors' pages get it.

## Privacy notes

- Anyone with the link can see your name, employee ID, cell number, calendar colors and credentials PDF. The page tells search engines not to list it.
- Your bug-report email is in the public calendar file, because supervisors' browsers send reports to it, and a saved address stays in the file's history even if you change it later. To keep it private, tap **Send a Test**, activate, and paste the random code FormSubmit emails you in place of your email before you tap **Save**.
- After you publish a new version of the site, reload any calendar tab you left open on your phone or computer before editing there. An old tab doesn't know about newer settings.
- A replaced or removed credentials PDF stays in the repository's history on GitHub, so anyone who looks there can still find older versions.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop Editing on This Device**, or delete the token on GitHub. Stop Editing also clears that browser's unsaved changes and its backup copy of your every-week days and times, and closes edit mode in that browser's other tabs.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
