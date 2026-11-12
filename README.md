# Smart Money

A simple monthly budget: income, debt and expenses. It has the same look and setup as Habito and Pomo: black and white, no account, no ads, and it works offline.

## Use it

```sh
npm start          # http://localhost:8080
npm test           # engine tests
```

There are no dependencies and no build step. To put it on your iPhone, host the folder on any static host (GitHub Pages works: Settings → Pages → deploy from this branch), open it in Safari, then tap Share → Add to Home Screen. It runs full-screen and offline. Data stays on the device; use Setup → Export backup to keep a copy.

## How a month goes

1. **Plan.** Add income, then give it to debts and expenses until “left to budget” reaches $0.
2. **Add** lines right in the list: tap **+ Add expense**, type a name, press return, type the amount, press return. A fresh row opens for the next one. Tap a line later for details (due day, spent, balance).
3. **Track.** Tap a line to enter what you spent, paid or received. The **Add** box adds to the total (for example, each grocery run).
4. **Check.** Switch between **Planned**, **Spent** and **Remaining** at the top.
5. **Next month.** Tap ›, then **Copy last month’s budget**. Lines, planned amounts and due days carry over, and nothing is marked spent yet. Or start empty.
6. **Reset budget** (bottom of the month) gives three choices: set planned amounts to $0, copy last month, or start from scratch. You can undo it right after.

## Debts

Give a debt a **balance owed** and it goes down by whatever you mark paid, in any month. When it reaches $0 it is paid off. It is no longer copied into new months, and the Debts tab hides it under “Show paid off”. A debt without a balance works like a plain monthly payment.

## How it works

- `engine.js` is pure logic with tests. Money is stored as whole cents, so totals never drift. A month is `{ income, debt, expenses }`, and each line has `planned`, `actual` and an optional `due` day. Debts live outside the months, and what’s left on a debt = its balance − every payment against it.
- `app.js` handles the UI and saves to `localStorage` (`money:v1`). Saved and imported data is checked when it loads. Anything that can’t be read is kept under a `money:v1:unreadable:*` key instead of being overwritten.
- `sw.js` caches the app for offline use. Bump `CACHE` when you ship changes.
