---
name: Replit Mail delivery
description: How built-in Replit Mail routes messages and when an external provider is required.
---

# Replit Mail delivery behavior

Built-in Replit Mail (blueprint `replitmail`) ignores the `to` field and delivers
**only** to the Repl owner's verified email address, regardless of the recipient
passed in code.

**Why:** Confirmed during the Ameen Secretary build — meeting reminders set to a
test recipient (anas@ameen-ai.sa) actually arrived at the owner's verified inbox.
Replit Mail is zero-config but is not a general transactional mailer.

**How to apply:** Use Replit Mail when sending to the Repl owner is acceptable
(self-notifications, owner reminders). For arbitrary external recipients, integrate
a real provider (SendGrid, Resend, or SMTP) instead.
