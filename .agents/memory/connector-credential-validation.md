---
name: Connector credential validation
description: Replit connector connections can exist with invalid/placeholder credentials; verify with a read-only API call before assuming delivery works.
---

A connector being "connected" does NOT mean its credentials are valid. `listConnections(name)` can return a connection whose `status` is `null` and whose `settings` contain placeholder/invalid credentials that the provider rejects with HTTP 401/400.

**Why:** Observed with both Resend and Twilio. Resend's stored `api_key` (108 chars, not the normal `re_...` shape) returned 401 "API key is invalid" both via direct `api.resend.com` and via the official `@replit/connectors-sdk` proxy. Twilio's `phone_number` was the default sandbox number `+14155238886` and the account fetch returned 401 "Authenticate" — i.e. the connection "could not be assigned due to a temporary error" and never validly provisioned.

**How to apply:** After wiring a connector for outbound delivery, validate credentials with a cheap read-only call (Resend `GET /api-keys`, Twilio `GET /Accounts/{sid}.json`) before claiming delivery works. If `status` is null or the provider returns 401/400, it's a USER credential issue (they must (re)authorize/enter a valid key) — not a code bug. Don't keep retrying in code; surface it to the user.

**Confirmed field names (derivable via listConnections, recorded only as a sanity anchor):**
- Resend: `api_key`, `from_email`. Send: `POST https://api.resend.com/emails` with `Authorization: Bearer <api_key>`. Unverified domains only send to the account owner.
- Twilio: `account_sid`, `api_key`, `api_key_secret`, `phone_number` (NO `auth_token`). Auth = HTTP Basic `base64(api_key:api_key_secret)`, account_sid stays in the URL. WhatsApp From/To must be prefixed `whatsapp:`.

**Validating Resend & Twilio keys (gotchas):**
- A Resend "send-only" restricted key returns 401 on read endpoints (`GET /api-keys`) but sends fine — DON'T treat that 401 as invalid. Validate by actually sending (e.g. from `onboarding@resend.dev` to `delivered@resend.dev`).
- Resend refuses to send from an unverified domain: error "The <domain> is not verified" → user must add DNS records at resend.com/domains. Until then use `onboarding@resend.dev` (only reaches the account owner).
- Twilio Account SID starts with `AC...`; API Key SID starts with `SK...`. Easy to paste the SK into both fields → account fetch 404 (code 20404). Validate with `GET /Accounts/{AC...}.json` → 200.

**Bypassing a stuck Replit connector:** re-running proposeIntegration may report "set up successfully" yet leave the SAME stale/invalid credential in place (it never re-prompts for the value). When that happens, stop re-proposing and instead read keys from explicit Replit Secrets (env vars) with the connector as fallback.
