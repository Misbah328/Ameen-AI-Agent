---
name: onclick HTML-attribute injection with dynamic strings
description: Why building onclick="fn(...)" from JSON.stringify'd user/AI text breaks the page, and the cache-by-id fix.
---

# Inline onclick handlers must never embed dynamic text

Building an HTML `onclick="Handler.fn(${JSON.stringify(text)}, ...)"` string from
content that can contain quotes (Arabic titles, user input, AI output) breaks the
generated markup: `JSON.stringify` produces `"..."` whose double-quotes collide
with the attribute's own quotes, truncating the HTML and throwing
`SyntaxError: Unexpected end of input` in the browser — the whole render/handler
silently dies.

**Why:** the "Send Reminder" button crashed exactly this way — Arabic meeting
titles contain `"`.

**How to apply:** never serialize variable text into an inline handler attribute.
Instead, render only a stable id (`onclick="Handler.fn(123)"`), cache the full
list on a JS object (e.g. `App.scheduleCache = items`), and have the handler look
the record up by id. Same rule for any list-rendered row with edit/delete/action
buttons.
