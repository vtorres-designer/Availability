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

## The top of the page

A navy header with a faint display grid holds:

- **Your badge:** a shield with your initials (from your name in Settings), "Security Officer" and your name.
- **The status line,** with a softly pulsing green light: "Accepting overnight requests", built from the shifts you'll pick up in Settings ("Accepting overnight & swing requests", "Accepting overnight, swing & morning requests"). Uncheck them all and it says "Not taking extra shifts right now", with the light off.
- **Call Me** (a rotary phone): it doesn't show your number. It opens a small box: "Best for shifts starting within 10 hours." and "Otherwise, a text is best. Pick the day below and I'll show you the best way to reach me.", with a **Pick a Day** button. That scrolls to the calendar only if it isn't already on screen (on a laptop it is), and makes the days they can ask about glow twice. So every request goes through the calendar's screening first; your number comes at the end, the same as always. The 10 follows your Settings (Ask supervisors to call when a shift starts within). At 0, the box says "Texting is the best way to reach me." instead. It shows only when your cell number is set.
- **Your license:** "Denver Security Guard License · Active". Tap it to see the number and dates ("Issued Jun 16, 2026 · Expires Jun 16, 2027 · Renews yearly"). After the expiration date it says Expired, and edit mode reminds you to enter the new dates. Set it in Settings → License; leave the name empty to hide it.

**When the page opens** (about 3 seconds, and nothing waits on it):
1. The page breathes in. Your name falls into place letter by letter, and the days drop in on a diagonal wave from the top left to the bottom right.
2. The status light switches on and "Accepting overnight requests" types itself out like a terminal.
3. Once it has finished, a sparkle flashes in the middle of the strip under the header, and the strip opens out both ways. A ring of light runs out along the grid from your badge, and the badge shines and sparkles.
4. A shine crosses Call Me, then the license button.

**Then, for as long as the page is open:**
- the strip's colors flow and the grid drifts slowly
- the status light pulses, and your name glows in step with it
- the green, yellow and P-OT days breathe a soft glow together (P-OT glows green); a day under a mouse holds its full glow
- the blue arrow in front of "Tap a green or yellow day to text me about covering it." nudges toward it
- every 9 seconds the Call Me and license icons glitch for a split second

While the calendar loads, the page stays out of sight (never more than 4 seconds; on a slow connection it simply appears after 1.5, with only the ongoing effects). People who turn off motion on their device see none of the animation. In edit mode the days don't breathe.

The days a supervisor can ask about look like raised buttons; busy days lie flat and a little sunken, so the eye goes to the days you can take. Times and labels (week names, weekdays, "UPDATED 19:02 · OCT 8") use a monospace readout font, and today has a thin glowing outline. The links at the bottom each have a small icon.

**The night-shift line is part of your note:** "A night shift is listed under the day it starts. Tue means Tue night into Wed morning." Checking **Overnight** under the shifts you'll pick up (Settings) adds it to your note, where you can edit or delete it like the rest; unchecking Overnight takes it out, and checking it again adds it back. If it doesn't fit in the note's 140 characters, Settings says so. The first time you open edit mode after this update, the line moves into your note on its own (tap **Save** to publish it); until then the page shows it in the Note box by itself. Like the rest of the note, it hides after a **Show the note until** date.

**Your note** (Settings → Note to supervisors) shows in a framed **Note** box near the top of the page, and again at the top of every day's window, so it's in front of supervisors right when they ask you for a shift. Give it a **Show the note until** date and it hides itself after that day, so a note like "Looking for extra hours this week" doesn't go stale.

## How supervisors text you

1. **They tap a green or yellow day** and are asked **Which shift do you need covered?** (Morning, Swing or Overnight). A shift you don't take gets a short reply, like "Sorry, I'm not accepting Morning shifts right now." (P-OT days skip this step; see below.)
2. **A simple window** asks **When does the shift start?** and **When does the shift end?**: a box for the time ("11", "1130", "11:30", "11pm") with **AM** and **PM** buttons. A 24-hour time like 2300 or 0700 picks PM or AM by itself.
3. Under that is **Your Text**, the message as it will go out, updating as they enter the times:

   > Hi Vincent. Are you available to cover an overnight shift on the night of Tuesday, Oct 13, from 11:00 PM to 7:00 AM? Let me know. Thanks!

   A supervisor who has customized a text before on that device gets their saved name in it too ("This is Sgt. Martinez."). A short list suggests what else they can add (their name, the site name and address, the pay rate), either in their own texting app before sending or by tapping **Customize Text First**.
4. **Send Text Now** (it turns on once both times are in) sends it right away. **Customize Text First** opens the full form with the times already filled in: Your Name, Shift Time, Site Name, Site Address and Pay Rate, each "(optional)". Each box they fill in adds a sentence. **Change Times** goes back.

**Going back.** Every step after the first in a day's window has a **Back** button at the top left, opposite the ×. The phone's back gesture (and a browser's Back button) does the same: it steps back one screen at a time, then closes the window, and never leaves the page while a window is open. Going back never loses anything: the times they entered and any edits to the custom text are still there when they go forward again, for as long as that day's window stays open. **Change Shift** and **Change Times** still work as shortcuts. In edit mode, Back also ends **See What Supervisors See**.

The wording fits the shift: "on the night of" for overnight, "on the day of" for morning, "on the evening of" for swing.

When some of the shift would be overtime for you, the text ends with how much: "You'd get overtime pay for 5 of the 8 hours of this shift." or "…for all 8 hours of this shift." The count follows the times they enter, and the line at the top of the window changes with it ("I'm available, but 2 of the 8 hours would be overtime"). Without times, the text just says "…for part of this shift" or "…for covering this shift". On the last day of a pay week, a shift is split at midnight between the two weeks: if this week is full, a 10 PM start gives 2 overtime hours and an 11 PM start gives 1. The day's color shows the shift with the most overtime, and the window says which shift is which.

### Sending, by device

- **Phones and tablets** (iPhone, iPad, Android, Galaxy Tab, including big Android tablets set to show the desktop site): **Send Text Now** opens their default texting app with the message filled in. In the full form the buttons are **Open Texting App**, **Copy Message** and **Copy Number**. A small line covers other apps: "Use a different app, like TextNow? Copy the message and number, then paste them there." The text comes from their own number, so you can reply to them directly.
- **Laptops and desktops:** a computer can't send a text, so there are no texting buttons. **Send Text Now** shows a QR code: "Scan with your phone's camera to text me." Their phone's camera opens the text in its texting app, ready to send. Under it: "Or text (720) 669-4305 from your phone." In the full form the QR code is right beside the message.
- **Macs:** also get a small **Open in Messages on this Mac** link, which sends the text from Messages if their Mac is linked to an iPhone.

Their device remembers their name, site, address and pay rate for next time.

### Shifts starting soon

If the shift starts in less than 10 hours (or has already started), any way of sending first shows: "Heads up: this shift starts in less than 10 hours. I may be asleep and not see a text in time. Please call me instead." with **Call Me** and **Text Anyway**. Sending from the full form with Shift Time left blank counts from the earliest the shift could start, midnight as that day begins: today always asks ("if this shift starts in less than 10 hours…"), tomorrow only once midnight is less than 10 hours away (from 2 PM today), and later days never (with a setting over 24 hours, the same rule reaches into the day after). On a phone, Call Me dials you; on a computer it shows your number to call from their phone. Text Anyway goes ahead and isn't asked again for the same times. The 10 hours is a setting (Settings → Ask supervisors to call when a shift starts within); 0 turns the warning off. It goes by the supervisor's device clock.

### P-OT days

A P-OT day (half yellow, half green) skips the shift buttons, because there the times decide everything. The window says "I'm available, but part of the shift would be overtime" and "Let's work out how many hours of the shift you need covered would be overtime.", then asks for the start and end times the same way.

Once both times are in, a bar shows the shift hour by hour: one block per hour, labeled with the hour it starts (11 PM, 12 AM, 1 AM…), green for regular hours and yellow for overtime, with a line under it like "8 hours: 3 regular, 5 overtime." A block where overtime starts partway through the hour is split, and a last half hour fills half its block. Labels shrink to fit small screens. The top line gives the number ("5 of the 8 hours would be overtime"). Then come the same **Your Text**, **Send Text Now** and **Customize Text First**, and a small **Pick Another Day** link that goes back to the calendar.

The message says "a shift on the night of…", "on the evening of…" or "on the day of…" depending on the start time (from 7 PM, from 3 PM, from 5 AM). If your start times run past 5 AM (like 1500-0800), a start the next morning from 5 AM on is worded as that next day ("on the day of Friday").

Your **P-OT Shifts** settings decide what you'll take on those days:
- **Start times I'll accept**, like `1900-0300`. A range can run past midnight; then a start after midnight (like 1 AM) means the next morning. A start outside the range gets "Sorry, I can only start a shift between 7 PM and 3 AM that day."
- **Longest shift**, like 10 hours. A longer one gets "Sorry, I can't take a shift longer than 10 hours that day."

Either box can be left empty for no limit. A shift you'd turn down shows no bar and can't be sent, and if a supervisor changes the Shift Time on the full form to one you'd turn down, the top line says why and sending turns off. Supervisors can see these two settings, since their page does the checking; they say what you'd accept, not when you work.

### On a laptop

On a wide screen (a laptop, or a tablet turned sideways) the front page is two columns: the header (as a card), your note, color key and links on the left, the calendar on the right. The calendar scrolls by itself when it's long, so the page fits the screen. Edit mode is laid out the same way. On a short laptop screen, edit mode may scroll a little to reach the Employee ID and Updated lines, but the calendar stays in view. The full message form sits side by side too: the boxes on the left, the message and the QR code on the right, so nothing needs scrolling.

## Works on any device

Supervisors can open the link in any current browser on an iPhone, Android phone, iPad, Windows PC, Mac, Chromebook or Linux computer. Phones and browsers back to about 2019 work too. See "Sending, by device" above for how each one sends.

## Sharing

Anyone can tap **Share This Calendar** at the bottom of the page, next to **See My Credentials**. It shows the link with a **Copy Link** button, the device's own share menu (on phones, tablets and most computers), and a QR code someone can scan with a phone camera.

## Links at the bottom of the page

- **See My Credentials** opens your credentials PDF. It shows only after you upload one in Settings.
- **Share This Calendar** shows the link to copy or share (see Sharing above).
- **Send Feedback** opens a short form: "Something confusing, missing, or broken? Tell me. I read every message." Three optional choices (**Something's broken**, **Something's confusing**, **I have an idea**) change the question over the message box and the email's subject. They tap **Send Feedback**, and it's emailed to you with their device and browser type. It shows only after you add your email in Settings.
- **Admin Login** is how you get into edit mode.
- Your **employee ID**, if you set one, is in small grey text under these links, above when you last saved.

## What supervisors never see

The page never shows your shift times, the hours of any one day, notes (like the site name), or whether a red day is work or something personal. It shows the days, the colors, the shift names you'll pick up, your P-OT start times and longest shift, your name, your number, your note, your short-notice hours, your license (if you set it), and when you last saved.

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
- Your name (shown at the top, and the first name is used in texts), your **employee ID** (shown in small grey text at the very bottom, above the time you last saved), your cell number, how many hours ahead a shift has to be before supervisors are asked to call instead (10 by default; 0 turns it off), and an optional note with an optional show-until date (shown in the Note box and in each day's window). Changing your name changes it in both places. Supervisors see it after you tap **Save**.
- **Credentials PDF:** **Upload PDF**, **Replace PDF** or **Remove PDF**. These happen right away, without tapping Save. Supervisors see the change within a minute or two. The limit is 20 MB.
- **License:** the name, number, issue date and expiration date for the button at the top of the page.
- **Email for feedback:** where Send Feedback messages go. They're forwarded by [FormSubmit](https://formsubmit.co), a free service with no account. The first message to a new address sends you an email from FormSubmit; open it and tap **Activate Form**, or nothing arrives. Tap **Send a Test** to do that right away. Reports sent before you activate are delivered once you do. Like everything in Settings except the PDF, the address reaches supervisors when you tap **Save**.
- **Pay week ends** sets the day your pay week ends at midnight (Thursday for you). Hours are counted by the clock: a Thursday 2300-0700 shift counts 1 hour toward that week and 7 toward the next.
- **P-OT Shifts:** the start times and longest shift you'd take on a P-OT day (see P-OT days above).
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide the colors. A day is green when one more usual-length shift keeps its pay week at 40 or less, P-OT when only part of that shift would go past 40, and yellow when all of it would. On the last day of a pay week, an overnight pickup is split at midnight, with most of it counted in the next week.
- After you publish a new version of the site with a new public setting (like the hours left before overtime), opening edit mode shows **Save 1 Change**. Tap **Save** once so supervisors' pages get it.

## Privacy notes

- Anyone with the link can see your name, employee ID, cell number, license number and dates (if you set them), calendar colors and credentials PDF. The page tells search engines not to list it.
- Your feedback email is in the public calendar file, because supervisors' browsers send reports to it, and a saved address stays in the file's history even if you change it later. To keep it private, tap **Send a Test**, activate, and paste the random code FormSubmit emails you in place of your email before you tap **Save**.
- After you publish a new version of the site, reload any calendar tab you left open on your phone or computer before editing there. An old tab doesn't know about newer settings.
- A replaced or removed credentials PDF stays in the repository's history on GitHub, so anyone who looks there can still find older versions.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop Editing on This Device**, or delete the token on GitHub. Stop Editing also clears that browser's unsaved changes and its backup copy of your every-week days and times, and closes edit mode in that browser's other tabs.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
