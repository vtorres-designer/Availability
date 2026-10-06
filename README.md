# Shift Availability

A one-page calendar you text to supervisors. They open the link, see which nights you can cover, and tap a night to text you. It's free: GitHub Pages hosts it, and texts go from the supervisor's own phone.

| Color | Meaning |
|---|---|
| Green **OPEN** | Available. |
| Yellow **OT** | Available, but the shift would push that week past 40 hours. |
| Red **WORK** | You're already working that night. |
| Red, striped **BUSY** | You blocked it (plans, appointment, want it off). |
| Grey **TBD** | Past the date your schedule is entered through. |

A night is listed under the day it starts. Tue means Tue 10 PM to Wed 7 AM.

When a supervisor taps a green or yellow night, they get one button per shift you'll pick up (Overnight, Swing, Morning). The button opens their texting app with a message already written, for example:

> Hi Vincent, it's Maria. Can you cover an overnight shift from Thu, Oct 15 at 10 PM to Fri, Oct 16 at 7 AM?

They hit send. The text comes from their own number, so you can reply to them directly.

## Files

- `index.html`, `app.css`, `app.js`: the site.
- `data.json`: your calendar. The site saves this file when you tap **Save**.
- `.nojekyll`: tells GitHub Pages to serve the files as they are.

## One-time setup

1. **Create the repo:** at <https://github.com/new>, name it `availability`, set it to **Public**, tick **Add a README**, and create it. Pages is free only for public repos.
2. **Add the files.** Either let Claude push them (the Claude GitHub app needs access to the repo), or use **Add file → Upload files** and drag in everything in this folder, including `.nojekyll`.
3. **Turn on Pages:** go to **Settings → Pages**. Under Build and deployment, set Source to *Deploy from a branch*, Branch to `main`, and folder to `/ (root)`. Then tap **Save**.
4. After about a minute the site is live at `https://vtorres-designer.github.io/Availability/ (the capital A matters: it has to match the repo name exactly)`.
5. **Connect your phone for editing:** open the site, tap **Vincent? Edit calendar** at the bottom, and follow the five steps on screen. They walk you through making a GitHub token that can change only this one repo. You paste it once per device.

## Updating your calendar

1. Open the site on your phone. Once you've connected, it opens in edit mode with a toolbar at the bottom.
2. Pick what a tap does:
   - **Working**: tap the nights LISA has you scheduled. Tap again to undo.
   - **Busy**: tap nights you won't take.
   - **Open**: tap to clear a night back to available.
   - **Tap to edit**: opens the night so you can set the shift type, paid hours, or which shifts you'd take that night.
3. In **Settings**, move **Schedule is entered through** forward to the last date you copied from LISA. The **+1 week** and **+2 weeks** buttons do this quickly.
4. Tap **Save**. Supervisors see the change within a minute or two.

Settings also has your cell number, a short note shown at the top (for example "Looking for extra hours this week"), your usual shifts and their times, and the overtime rules. Set **Work week starts** to match your paycheck week, or the yellow nights will be counted against the wrong week.

## Privacy

- The repo is public, so anyone with the link can see your calendar, first name and cell number. The page tells search engines not to list it.
- Your GitHub token is saved only in that device's browser. It can change only the `availability` repo. To remove it, open **Settings → Stop editing on this device**, or delete the token on GitHub.
- Your other GitHub Pages sites under the same account share the same web address, so they could read the token too. That's only a risk if you host someone else's code there.
