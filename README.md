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

- **Your badge:** a shield with your initials (from your name in Settings), "Security Professional" and your name.
- **The status line,** with a green status light that glows and dims on the same beat as your name: "Accepting overnight requests", built from the shifts you'll pick up in Settings ("Accepting overnight & swing requests", "Accepting overnight, swing & morning requests"). Uncheck them all and it says "Not taking extra shifts right now", with the light off.
- **Call Me** (a rotary phone): it doesn't show your number. It opens a small box: "Best for shifts starting within 10 hours." and "Otherwise, a text is best. Pick the day below and I'll show you the best way to reach me.", with a **Pick a Day** button. That scrolls to the calendar only if it isn't already on screen (on a laptop it is), and makes the days they can ask about glow twice. So every request goes through the calendar's screening first; your number comes at the end, the same as always. The 10 follows your Settings (Ask supervisors to call when a shift starts within). At 0, the box says "Texting is the best way to reach me." instead. It shows only when your cell number is set.
- **Your license:** "Denver Security Guard License · Active". Tap it to see the number and dates ("Issued Jun 16, 2026 · Expires Jun 16, 2027 · Renews yearly"). After the expiration date it says Expired, and edit mode reminds you to enter the new dates. Set it in Settings → License; leave the name empty to hide it.

**When the page opens** (about 3 seconds, and nothing waits on it):
1. The page breathes in. Your name falls into place letter by letter, and the days drop in on a diagonal wave from the top left to the bottom right.
2. The status light switches on and "Accepting overnight requests" types itself out like a terminal.
3. Once it has finished, a sparkle flashes in the middle of the strip under the header (on a laptop, in the gap between the panel and the calendar), and the strip opens out both ways. A ring of light runs out along the grid from your badge, and the badge shines.
4. A shine crosses Call Me, then the license button.
5. Once every shine is done, a big sparkle (a star, a small star and a ring of light) bursts on the badge's top-right corner.

**Then, for as long as the page is open:**
- the strip's colors flow and the grid drifts slowly
- the status light glows and dims, and your name glows in step with it
- the green, yellow and P-OT days breathe a soft glow together (P-OT glows green); a day under a mouse holds its full glow
- the blue arrow in front of "Tap a green or yellow day to text me about covering it." nudges toward it
- every 9 seconds the Call Me and license icons glitch for a split second

While the calendar loads, the page stays out of sight (never more than 4 seconds; on a slow connection it simply appears after 1.5, with only the ongoing effects). People who turn off motion on their device see none of the animation. In edit mode the days don't breathe.

The days a supervisor can ask about look like raised buttons; busy days lie flat and a little sunken, so the eye goes to the days you can take. Times and labels (week names, weekdays, "UPDATED 19:02 · OCT 8") use a monospace readout font, and today has a thin glowing outline. The links at the bottom each have a small icon (left out on the smallest phones, so each pair still fits on one line).

## Notes to supervisors

You can have up to 10 notes, each up to 140 characters, and each shows where you choose. Set them in **Settings → Notes to supervisors**: one tab per note, then **+ Add Note**. For the open note:

- **The text,** with a counter (140 characters, one line).
- **Show until** (optional): the note hides itself after that day, by the supervisor's clock, so a note like "Looking for extra hours this week" doesn't go stale. Once the date has passed, Settings says supervisors don't see it.
- **Show this note on,** three switches:
  - **Front page:** in the Note box under the header. Several front-page notes sit one under the other, each with its own NOTE tag.
  - **Day window:** at the top of the window that opens when a day is tapped, on every step except the Customize Text First form.
  - **Customize Text form:** at the top of that form instead. So a note never shows twice in one place, and the form shows exactly the form notes.
- **Delete Note** (your own notes only). The rest are numbered again: Note 1, Note 2…

A new note starts on the front page only. Where no note is switched on, nothing shows: no empty box, no gap. Notes are never part of the text a supervisor sends. A tab's small light is on while its note shows somewhere.

**The night-shift note** ("A night shift is listed under the day it starts. Tue means Tue night into Wed morning.") is always there as the **Night shifts** tab, on the front page to start with. It shows only while **Overnight** is checked under the shifts you'll pick up: uncheck Overnight and the note and its tab go away; check it again and they come back as they were. You can change its text and switches, or empty it so nothing shows, but not delete it.

Every change to a note is an ordinary unsaved change: tap **Save** to publish it. Your note from before this version came over by itself (the night-shift line from it became the Night shifts note), so there's nothing to redo.

## How supervisors text you

1. **They tap a green or yellow day** and are asked **Which shift do you need covered?** (Morning, Swing or Overnight). A shift you don't take gets a short reply, like "Sorry, I'm not accepting Morning shifts right now." (P-OT days skip this step; see below.)
2. **A simple window** has **Starts** and **Ends** side by side: each a box for the time ("11", "1130", "11:30", "11pm") with a two-part **AM | PM** bar under it. A 24-hour time like 2300 or 0700 picks PM or AM by itself. Side by side, they leave room on a phone for **Send Text Now** and **Customize Text First** right under the text, without scrolling.
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

## On a laptop

On a wide screen (a laptop or desktop, or a tablet turned sideways) the front page fills the window. The navy header becomes a band across the whole width: your badge and name large on the left, the status light under your name, and Call Me and the license button in one line on the right, with the box they open right under them. Below the band, a white panel on the left holds your front-page notes, the "Tap a green or yellow day" line and the color key, and the calendar sits beside it; both float over the band's lower edge, with the strip running along the band's bottom behind them. The four links run in one line along the bottom, with the Employee ID and Updated line under them. The days grow with the window, sharing its height between the weeks shown, so with three weeks the whole page fits without scrolling, from a small 960 × 560 window up to a big desktop screen (on short windows the header and spacing get tighter, and in Call Me's box the Pick a Day button sits beside the text). When the calendar has more weeks than fit, it scrolls by itself, with the weekday names staying at its top, and the page doesn't move. In a window taller than it is wide (a big tablet held upright), the page ends under the calendar instead of keeping the links at the very bottom. See What Supervisors See shows this same layout, just as it looks in a window shorter by the height of the bar along its bottom. A browser from before about 2020 shows the one-column page that a tablet held upright gets instead.

Edit mode keeps its two columns: the header (as a card), the edit-mode box, color key and links on the left, the calendar on the right, scrolling by itself. On a short laptop screen, edit mode may scroll a little to reach the Employee ID and Updated lines, but the calendar stays in view. The full message form sits side by side too: the boxes on the left, the message and the QR code on the right, so nothing needs scrolling.

## My Uniform

Supervisors who booked a shift with you can pick what you'll wear, from drawings of your own clothes. A small navy **My Uniform** button (a green shirt, with a green lock and CODE under the words) floats in the bottom right corner of the page, with a shine crossing it now and then. It shows once you've set a code and added at least one top and one pair of pants, on the page supervisors see and in See What Supervisors See (above the preview's bar), never in edit mode. On a phone the page ends far enough below the links that the button never covers them there; while it would sit on a day or a link (or the employee ID) as the page scrolls, it steps aside until they've scrolled past, so a tap meant for a day never opens My Uniform. On a laptop the bottom right corner is kept free for it.

It opens a full-screen page over the calendar, in three steps:

1. **The code.** Your header's look across the top half of the screen: "My Uniform", "Booked a shift with me? Pick what you'd like me to wear.", then a card with a box for the **code from my text** and **Open** (Enter works too), and a faint mannequin underneath. Small letters and spaces are fine. A wrong code says "That code doesn't match. Check my text and try again." Once a code works, that browser tab doesn't ask again until it's closed (and if you change the code, the old one stops working right away).
2. **The clothes.** A row of cards for each kind: Tops, Pants, Tie and Blazer (rows you have nothing for are left out). Each card shows just the drawing's clothes, cropped close, and its name. One pick per row; tapping another card replaces it. Tie and Blazer start on **None**. A top that can't be worn with a tie or a blazer (a polo) switches those rows off with a line like "No tie with the navy polo.", and drops a tie or blazer already picked. The picks show under **Your picks** as bubbles, each with an × to take it off. **See It On the Mannequin** turns on once there's a top and pants. On a phone each row scrolls sideways; on a wider screen all the cards are in view.
3. **Your Pick.** A flat navy mannequin wearing the picks, layered pants, top, tie, blazer (a shirt shows buttoned up when a tie is picked and you've added that drawing), and **Your text**: "Hi Vincent, for the shift please wear: White uniform shirt, long sleeve; navy tie; black blazer; black dress pants. Thanks!" **Send As Text** works like the calendar's texts: on a phone it opens their texting app with your number and the text (with Copy Message and Copy Number for other apps); on a computer it shows a QR code to scan, your number, and a **Copy Message** button. There's no short-notice check here, since it isn't about a shift time. On a laptop the mannequin stands beside the text.

Every step is a screen of its own, so Back (the phone's gesture or the browser's button) steps back one screen at a time, and **‹ Calendar** (or Escape) closes it, leaving the calendar where it was. **‹ Change Outfit** goes back to the clothes with the picks still there.

**Links:** add `#uniform` to your calendar's link to open the code page, or `#uniform-` and the code (like `…/Availability/#uniform-K7Q2MX`) to open straight to the clothes. The code is cleared from the address bar right away (even when My Uniform can't open, which then says "My Uniform isn't available right now."), so it isn't left in a link someone copies. A wrong or old code in a link shows the code page with that code and the message. Opened from a link, the first tap inside it lets Back return to the calendar instead of leaving the page.

The code is a "knock first", not a lock: the public calendar file has only a scrambled form of it (its SHA-256 hash), and anyone with the code can open the page. The code itself is saved with your private settings, never in the public file.

### Setting it up (edit mode)

**Settings → My Uniform**, right after License:

- **Code for My Uniform:** 4 to 8 letters or numbers (small letters become capitals). **New Random Code** makes a 6-character one without the letters and numbers that look alike (I, L, O, 0 and 1). Text it to a supervisor once you've confirmed their shift. Change it any time; once you tap **Save**, the old code and old links stop working. Leave the box empty to turn My Uniform off. A code that's too short is never used: the one you had stays, and Settings tells you.
- **Copy Link With Code** copies your calendar's link with the code built in (like `…/Availability/#uniform-K7Q2MX`), to text instead of the code. The link opens straight to the clothes. The link is shown under the button. A new code (and its link) works for supervisors only once you've tapped **Save**, and a line under the link says so until then.
- The code is kept with your private settings, so changing it needs your key's **Variables** permission. If your key can't save those, the box is switched off, with a line saying why. If a save stopped halfway (your private settings saved, the public file not), the next visit notices that the public file still has the old code and shows **Save 1 Change** to finish it.
- **My clothes:** a card for each item (its drawing on a white tile, and its name), tops first, then pants, ties and blazers, and **+ Add Item** at the end (up to 40 items). Tap a card to change or delete it. A line under them says whether supervisors see the button yet (it needs a code, a top and a pair of pants).

### Adding an item

**+ Add Item** opens a window (on a laptop, the mannequin sits beside the rest):

1. **Category:** Top, Pants, Tie or Blazer. Pick it first: the drawing prompt changes to match.
2. **For a top, two switches:** **Can be worn with a tie** (off for polos and anything without a collar) and **Can be worn with a blazer** (usually long-sleeve dress shirts only). When a supervisor picks that top, they decide whether the Tie and Blazer rows are open.
3. **Copy Drawing Prompt.** Paste it into a drawing AI with a photo of the item. For a top that can be worn with a tie, **Copy Buttoned-Up Prompt** asks for a second drawing with the collar buttoned up: paste it in the same chat right after the AI draws the shirt, so it changes only the collar. If your browser won't copy, the prompt shows on screen, selected, so you can copy it yourself.
4. **Choose Drawing:** the picture the AI made. Use a drawing with a transparent background (PNG or WebP). One on plain white still works, but it covers the mannequin, and the window says so. For a top worn with a tie, there's also **Buttoned-up version (for a tie)** (optional; **Remove It** takes it off again).
5. **Name:** supervisors see it, and it's in the text they send you (up to 60 characters).
6. **Fit on the mannequin:** the drawing on the mannequin, with one of your other items faintly behind it for scale (pants under a top, a top over pants, a top under a tie or a blazer). If the AI put it a little off, drag it into place and use **Size** to make it bigger or smaller, once per item. **Reset** puts it back where the drawing had it. With a keyboard, tab to the mannequin and use the arrow keys (hold Shift to move it further).
7. **Save Item** uploads the drawing right away (the window stays open until the upload is done; if a phone's Back closes it anyway, the item is still added). The item itself is then an unsaved change, like any other: tap **Save** to show it to supervisors. **Cancel** drops what you changed in the window. **Delete Item** asks first, then takes it off the list (for supervisors, once you tap Save). An item deleted in another tab or on another device while its window was open here isn't brought back.

Before uploading, the page gets each drawing ready: anything bigger than 600 × 1200 is made smaller (never bigger), it's stored as WebP where the browser can make it (PNG otherwise), and the edges of what's drawn are found from its transparent part, so the picker's cards show just the clothes. A file that isn't a picture, or one over 10 MB, is turned away with a message saying why.

Until GitHub Pages has a new drawing (a minute or two), edit mode and See What Supervisors See show it from the upload, or from GitHub after a reload. A new drawing gets a new file name, so no one's browser keeps showing an old one (changing an item's name, switches or fit keeps its files). After each **Save**, drawings nothing uses any more are deleted from `uniform/`. One that another device uploaded for an item it hasn't saved yet is left alone for 30 days, as long as unsaved changes are kept, and one this browser uploaded in the last 10 minutes waits for a later save (it may belong to an item still being added).

Uploads use your token's **Contents** permission, like the credentials PDF. If GitHub turns one down, the window says why and keeps everything, so you can tap **Save Item** again.

### The drawing prompts

What **Copy Drawing Prompt** copies, here for a top:

```
Please draw a clothing illustration for the uniform picker on my website. I've attached a photo of the real item.

WHAT TO DRAW
- Only the item in the photo, exactly as it is: same color, collar, pockets, buttons, stitching, patches and badges.

STYLE
- A clean, flat illustration, like a fashion flat sketch: solid colors that match the real fabric, a thin outline a little darker than the fabric, and soft shading only for folds.
- Straight-on front view, symmetrical, as if worn by an invisible person standing straight with arms relaxed at their sides.
- No person, mannequin, hanger, shadow, floor, text or watermark.

CANVAS (so it lines up on a mannequin on my website)
- Portrait, exactly 1:2, for example 800 x 1600 pixels.
- Transparent background (PNG). If you can't make it transparent, use plain solid white with nothing else on it.
- Picture a person filling the canvas from the top of the head at the top edge to the soles at the bottom edge, centered left to right. Draw the item only, where it would sit on that person:
- It's a top. The collar sits about 13% down from the top edge, the shoulders span about 40% of the width, and the hem sits about 50% down. Sleeves hang straight down at the sides; long sleeves end at the wrists, about 50% down.
- If it has a collar and buttons, draw the top button undone with the collar slightly open.

If I send more items in this chat, keep the same style, canvas and scale for all of them so they match.

Give me just the image.
```

For the other categories, the lines after "where it would sit on that person:" are:

- **Pants:** They're pants. The waistband sits about 48% down from the top edge and the hems about 96% down, legs straight and slightly apart, about 40% of the width across the hips.
- **Tie:** It's a tie, hanging straight down the middle. The knot sits about 16% down from the top edge and the tip about 42% down. The tie is about 7% of the width across at its widest.
- **Blazer:** It's a blazer, worn open. The shoulders span about 42% of the width at about 13% down, sleeves hang straight down to the wrists (about 50% down), and the hem sits about 54% down. Leave a V-shaped gap down the front, from the collar to the hem, where a shirt and tie would show.

**Copy Buttoned-Up Prompt** copies:

```
Now make a second version of the shirt you just drew.

Keep everything identical: the same canvas size, position, scale, colors, outline, shading and transparent background.

The only change: button the collar all the way to the top, closed snugly around the neck, the way it's worn with a tie. Don't draw a tie.

Give me just the image.
```

### Photo tips

For the photo you give the drawing AI:

- **One item per photo,** all of it in the frame and filling most of it.
- **Flat and straight on:** lay it on a bed or the floor (or hang it on a door), buttoned and smoothed out, sleeves straight down at the sides, and shoot from straight above (or straight in front).
- **A plain background** that's a different color from the item: dark pants on a light sheet, a white shirt on something darker.
- **Even light,** like daylight from a window. No flash, and no strong shadows across it.
- **The details close enough to read:** patches, badges, pockets and buttons, since the drawing copies them.
- **Pants buttoned and zipped,** legs straight and slightly apart. Ties hanging straight; blazers open.
- **Every item in the same chat,** one after another, so the drawings match in style and size. A clear phone photo is plenty.

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

The page never shows your shift times, the hours of any one day, your private day notes (like the site name), or whether a red day is work or something personal. It shows the days, the colors, the shift names you'll pick up, your P-OT start times and longest shift, your name, your number, your notes to supervisors, your short-notice hours, your license (if you set it), your My Uniform drawings and their names (once you add them; the code that opens them isn't in the page), and when you last saved.

To count overtime hours from whatever shift time a supervisor types, the public calendar file also has your usual shift length and, for each pay week within one usual shift of overtime, how many hours you have left before it. Weeks further from overtime aren't listed. From those numbers someone could work out your weekly total ("2 hours left, so he's at 38"), which you're fine with. GitHub keeps every older copy of the file, so comparing two copies can also show how many hours a newly red day added.

Your shift times are never in the page or the file, and the numbers can't be used to work them out. A shift on the last day of the pay week is split at midnight between two weeks, and a real split would give away the start time (1.5 hours before midnight means 10:30 PM). So in the public count, every shift that runs past midnight is taken to end at 7 AM, whatever its real times. For an 11 PM to 7 AM shift, that's exact. For others, the overtime count near the end of a pay week can be off by the difference. Your own hour totals in edit mode still use your real times.

A shorter shift than your usual one is always counted right. A longer one typed into a week that isn't listed (one with room for a full usual shift) is counted as no overtime.

The public calendar file (`data.json`) holds only that public part. Your times, hours and notes are kept in a private repository variable named `AVAILABILITY_PRIVATE` (**Settings → Secrets and variables → Actions → Variables**). Only you can see it.

## Files

- `index.html`, `app.css`, `app.js`: the site.
- `parser.js`: reads a pasted schedule.
- `credentials.pdf`: your credentials, if you've uploaded them. Settings adds, replaces and removes it.
- `uniform/`: the My Uniform drawings, once you've added some. Settings adds them, and a save deletes the ones nothing uses any more.
- `vendor/qrcode.js`: draws the QR code for computers. It's [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT license), kept in the repo so the page never loads code from another site.
- `data.json`: the public calendar. The site rewrites it when you tap **Save**.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

## Connecting a phone or computer for editing

The Admin Login window only shows a link to GitHub's token page and a box for the token, so curious visitors learn nothing. The steps live here:

1. Open GitHub's [fine-grained tokens](https://github.com/settings/personal-access-tokens) page. To make a token: **Generate new token**, name it **Availability calendar**, pick the longest expiration, and under Repository access choose **Only select repositories → Availability**. If you already have one, open it and tap **Regenerate token** to get a new code (GitHub only shows a code once).
2. The token needs two repository permissions, both set to **Read and write**:
   - **Contents** saves the public calendar, and uploads your credentials PDF and My Uniform drawings.
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

Changes you haven't saved stay on that device, even if the tab closes. They come back the next time you open the site. If you saved from another device in the meantime, only the days and settings you changed are put back (notes and My Uniform's clothes one by one, so a note or item added elsewhere stays), and anything saved differently since is skipped, with a message. Everything else comes from the newer save. If two devices save at nearly the same moment, the site asks what to do. **Add My Changes to It** keeps both, and your change wins on any day you both edited. If that would make more than 10 notes or 40 items, the ones saved elsewhere stay and the site says which of yours weren't added. **Load the Newer One** drops what you changed on this device.

If a save stores your hours but the public file then fails, your public changes (notes, My Uniform, and the rest of Settings) stay as unsaved changes on that device until a save gets through. An older copy of this page left open somewhere (from before notes and My Uniform) drops them when it saves; the next time you open edit mode on a device that saw them, they come back as unsaved changes, with a message. Close old tabs on every device after an update.

## Settings

- **Every Week:** check the days you work (or are busy) every single week. They show red every week until you uncheck them. For a day you work, you can add the start and end times and paid hours, so they count toward overtime and the yellow and P-OT days stay right. To change just one date, like a holiday, tap that day on the calendar (or paste it in Add Schedule). Picking **Every Week** in that day's editor puts it back. Adding, changing or turning off a day counts from today: days already past in this pay week keep what they were, and a day you turn off still counts today. On your calendar, these days show a small ↻. Supervisors just see red.
- The shifts you'll usually pick up. Supervisors see the names only.
- **Notes to supervisors:** see Notes to supervisors above.
- Your name (shown at the top, and the first name is used in texts), your **employee ID** (shown in small grey text at the very bottom, above the time you last saved), your cell number, and how many hours ahead a shift has to be before supervisors are asked to call instead (10 by default; 0 turns it off). Changing your name changes it everywhere it shows. Supervisors see it after you tap **Save**.
- **Credentials PDF:** **Upload PDF**, **Replace PDF** or **Remove PDF**. These happen right away, without tapping Save. Supervisors see the change within a minute or two. The limit is 20 MB.
- **License:** the name, number, issue date and expiration date for the button at the top of the page.
- **My Uniform:** the code, the link with it, and your clothes (see Setting it up, under My Uniform).
- **Email for feedback:** where Send Feedback messages go. They're forwarded by [FormSubmit](https://formsubmit.co), a free service with no account. The first message to a new address sends you an email from FormSubmit; open it and tap **Activate Form**, or nothing arrives. Tap **Send a Test** to do that right away. Reports sent before you activate are delivered once you do. Like everything in Settings except the PDF, the address reaches supervisors when you tap **Save**.
- **Pay week ends** sets the day your pay week ends at midnight (Thursday for you). Hours are counted by the clock: a Thursday 2300-0700 shift counts 1 hour toward that week and 7 toward the next.
- **P-OT Shifts:** the start times and longest shift you'd take on a P-OT day (see P-OT days above).
- **Overtime after** (40 hrs) and **Usual shift length** (8 hrs) decide the colors. A day is green when one more usual-length shift keeps its pay week at 40 or less, P-OT when only part of that shift would go past 40, and yellow when all of it would. On the last day of a pay week, an overnight pickup is split at midnight, with most of it counted in the next week.
- After you publish a new version of the site with a new public setting (like the hours left before overtime), opening edit mode shows **Save 1 Change**. Tap **Save** once so supervisors' pages get it.

## Privacy notes

- Anyone with the link can see your name, employee ID, cell number, license number and dates (if you set them), calendar colors and credentials PDF. The page tells search engines not to list it.
- Your feedback email is in the public calendar file, because supervisors' browsers send reports to it, and a saved address stays in the file's history even if you change it later. To keep it private, tap **Send a Test**, activate, and paste the random code FormSubmit emails you in place of your email before you tap **Save**.
- After you publish a new version of the site, reload any calendar tab you left open on your phone or computer before editing there. An old tab doesn't know about newer settings.
- A replaced or removed credentials PDF stays in the repository's history on GitHub, so anyone who looks there can still find older versions. The same goes for My Uniform drawings.
- Your GitHub token is saved only in that device's browser. To remove it, use **Settings → Stop Editing on This Device**, or delete the token on GitHub. Stop Editing also clears that browser's unsaved changes and its backup copy of your every-week days and times, and closes edit mode in that browser's other tabs.
- Older versions of `data.json` stay in the repo's history. The first version held the default shift times, not your real ones.
