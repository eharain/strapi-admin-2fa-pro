# Two-Factor Auth Pro for Strapi 5

Two-factor authentication (TOTP) for the **Strapi admin panel** — and, optionally,
for **users-permissions** accounts. An authenticator app, a QR code to set it up,
recovery codes for when the phone is gone, and a policy that says who has to use it.

> Strapi ships no second factor for the admin panel. If someone has an
> administrator's password, they have the Content Manager, the media library,
> the API tokens and the roles screen. This plugin puts a code in front of that.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

---

## What it does

- **Admin panel sign-in** asks for a six-digit code after the password.
- **Enrolment with a QR code**, plus a one-tap "open in your authenticator app"
  button on a phone, and the setup key in text for typing in by hand.
- **Recovery codes** — ten single-use codes, shown once, hashed at rest.
- **A policy you can set from the panel**: optional for everyone, required for
  everyone, or required for particular roles, with a grace period.
- **Forced enrolment at the door** — an administrator who is required to have an
  authenticator and does not gets the QR on the login screen and is signed in as
  soon as they confirm it. No separate trip to a settings page.
- **A coverage table** showing which administrators are actually protected, and
  a button to end everyone else's sessions so a new policy applies today rather
  than whenever those sessions happen to expire.
- **The same authenticator for users-permissions accounts**, on `POST
  /api/auth/local`, with its own endpoints for your own front end.
- **Lockout** after repeated wrong codes, per account rather than per IP.

## Install

```bash
npm install strapi-admin-2fa-pro
```

Strapi finds the plugin on its own. Restart, and there is a **Two-factor
authentication** section in Settings.

The first administrator to enrol should do it before you switch enforcement on —
see [Getting locked out](#getting-locked-out).

## Configure

Everything has a working default. To change one, add it to `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  'two-factor': {
    enabled: true,
    config: {
      // Encrypts factor secrets and signs the sign-in tokens.
      // Strongly recommended in production — see "Key material" below.
      encryptionKey: env('TWO_FACTOR_KEY'),

      // What the authenticator app lists the entry under.
      // Defaults to the host from admin.url, so two deployments are told apart.
      issuer: 'strapi.example.com',

      admin: {
        enforce: 'optional',        // or 'required'
        enforceRoles: [],           // e.g. ['strapi-super-admin']
        gracePeriodDays: 0,
      },

      users: {
        enabled: true,              // the users-permissions surface
        enforce: 'optional',
      },
    },
  },
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `encryptionKey` | `null` | Key material for factor secrets and tokens. Falls back to `admin.secrets.encryptionKey`, then `admin.auth.secret`. |
| `issuer` | host of `admin.url` | The name your authenticator app shows. |
| `digits` | `6` | 6, 7 or 8. Anything but 6 is spelled out in the QR. |
| `period` | `30` | Seconds per code. |
| `driftSeconds` | `30` | Clock skew tolerated either side. |
| `recoveryCodeCount` | `10` | Codes issued when a factor is confirmed. |
| `challengeTtlSeconds` | `180` | How long the code prompt stays valid. |
| `proofTtlSeconds` | `120` | How long the "second factor passed" proof lasts. |
| `maxAttempts` | `5` | Wrong codes before the account locks. |
| `lockoutSeconds` | `900` | How long that lockout lasts. |
| `admin.enforce` | `'optional'` | `'required'` makes every administrator enrol. |
| `admin.enforceRoles` | `[]` | Role codes that must enrol whatever `enforce` says. |
| `admin.gracePeriodDays` | `0` | Days before enforcement bites. |
| `users.enabled` | `true` | Whether users-permissions sign-in is gated at all. |
| `users.enforce` | `'optional'` | As above, for site accounts. |

The policy fields can also be changed from **Settings → Two-factor
authentication → Policy** without a deploy. The config file is the starting
point; the Settings page writes over it.

### Key material

Factor secrets are encrypted, not hashed — verifying a code means recomputing
it. The key is derived (HKDF-SHA256) from `encryptionKey`, or
`admin.secrets.encryptionKey`, or `admin.auth.secret`, in that order.

**That last fallback has a consequence.** If the plugin is relying on
`admin.auth.secret` and you rotate it, every enrolled authenticator becomes
unreadable and everyone who depends on one is locked out. Set `encryptionKey`
to something of its own and the two are independent.

## How sign-in works

```
POST /admin/login  {email, password}
      ↓  password correct, second factor in play
   401 TwoFactorRequiredError  { error.details.twoFactor: { challenge, … } }

POST /two-factor/challenge/verify  {challenge, code}
      ↓  code correct
   200 { data: { proof } }

POST /admin/login  {email, password, twoFactorToken: proof}
      ↓  proof valid
   200 { data: { token, user } }   ← Strapi's own handler, unchanged
```

Two things follow from that shape, and both are on purpose:

**A password alone never produces a session.** The gate answers before Strapi's
login handler runs, so no refresh cookie is set and no access token is minted.
There is nothing to intercept.

**The plugin is not in the session business.** The third call is the ordinary
login, handled by the ordinary handler — same validation, same session, same
cookie, same response. Nothing here re-implements token minting, so nothing here
drifts when Strapi changes how sessions work.

In the browser this is invisible: the plugin wraps `fetch`, sees the 401, opens
the prompt, and replays the sign-in itself. The panel's own code sees one
`fetch` that took a few seconds and then succeeded. There is no forked login
page and no patched component, which is why this keeps working when Strapi
redesigns that screen.

An API client that has not been taught the exchange gets a 401 and no token —
it fails closed.

## Endpoints

### Admin (`/two-factor`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/challenge/verify` | signed challenge | Present a code, get a proof |
| POST | `/challenge/confirm` | signed challenge | Confirm a forced enrolment and get a proof |
| GET | `/me` | any admin | Your own status |
| POST | `/me/enroll` | any admin | Start an enrolment (secret, `otpauth://` URI, QR) |
| POST | `/me/confirm` | any admin | Confirm it, receive recovery codes |
| POST | `/me/disable` | any admin | Remove it (needs a live code) |
| POST | `/me/recovery-codes` | any admin | Fresh codes (needs a live code) |
| POST | `/me/verify` | any admin | Check a code and change nothing else |
| GET | `/administration` | `settings.read` | Policy, roles, coverage |
| PUT | `/administration/settings` | `settings.update` | Change the policy |
| POST | `/administration/admins/:id/reset` | `admins.manage` | Remove someone's authenticator |
| POST | `/administration/admins/:id/unlock` | `admins.manage` | Clear a lockout |
| POST | `/administration/sessions/revoke` | `admins.manage` | End every other admin session |

The three permissions appear under **Settings → Roles → Two-factor
authentication**.

### Content API (`/api/two-factor`)

The same shape for users-permissions accounts: `/challenge/verify`,
`/challenge/confirm`, and `/me`, `/me/enroll`, `/me/confirm`, `/me/disable`,
`/me/recovery-codes`, `/me/verify` with the user's JWT.

These need no role permissions ticked — the routes authenticate the caller
themselves and refuse anyone who is not signed in.

### Using this as the store for your own sign-in

If you already have an identity service and want one place for second factors
rather than two, `POST /me/verify` is the seam:

```
POST /api/two-factor/me/verify
Authorization: Bearer <that person's JWT>
{"code":"123456"}

200 { "data": { "valid": true, "method": "totp", "recoveryCodesRemaining": null } }
401 { "error": { "message": "That code is not valid" } }
```

Your service keeps sign-in, sessions and step-up; enrolment, recovery codes,
replay protection and lockout live here. Every call is made with the person's
own token, so this plugin will not answer questions about somebody else — there
is no "check this code for user 42" endpoint to leak or to get wrong.

Note that a success spends the code and a failure counts towards the lockout, so
this is a verification, not a dry run.

Your front end handles the sign-in exchange the same way:

```js
const res = await fetch('/api/auth/local', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier, password }),
});

if (res.status === 401) {
  const { error } = await res.json();
  const twoFactor = error?.details?.twoFactor;
  if (twoFactor) {
    const code = await askTheUserForTheirCode(twoFactor);
    const { data } = await fetch('/api/two-factor/challenge/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge: twoFactor.challenge, code }),
    }).then((r) => r.json());

    return fetch('/api/auth/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, twoFactorToken: data.proof }),
    });
  }
}
```

## Getting locked out

The honest failure modes, and the way out of each:

| What happened | What to do |
| --- | --- |
| Lost the phone, have recovery codes | Use one at the prompt — "I do not have my authenticator". |
| Lost the phone, no recovery codes | Another administrator resets you: Settings → Two-factor authentication → Policy → Reset. |
| Too many wrong codes | Wait out the lockout, use a recovery code, or have an administrator unlock you. |
| Nobody can get in at all | Delete the row from `two_factor_factors` for that account, directly in the database. |
| `admin.auth.secret` was rotated and no `encryptionKey` was set | Every factor is unreadable. Truncate `two_factor_factors` and `two_factor_recovery_codes` and enrol again. |

Enrol one administrator and keep their recovery codes before switching
enforcement on, and none of the rest of this comes up.

## What it stores

Two collections, hidden from the Content Manager:

- `two_factor_factors` — one row per enrolled account: the encrypted secret
  (AES-256-GCM), the last accepted time step, the lockout state.
- `two_factor_recovery_codes` — keyed hashes, marked used when spent.

Both are keyed by `subjectType` (`admin` or `user`) and `subjectId`, so the two
surfaces share one implementation without sharing accounts.

## Security notes

- TOTP is RFC 6238 via [`otplib`](https://github.com/yeojz/otplib) — a vetted
  implementation rather than a hand-rolled HMAC loop.
- **Codes are single-use.** The accepted time step is kept, and the same code
  inside its own thirty-second window is refused as a replay, not accepted again.
- **Wrong codes are counted per account, not per IP** — an attacker cannot buy
  more guesses by changing address.
- **Secrets are encrypted; recovery codes are hashed.** The first has to be read
  back, the second never does.
- **Tokens are signed and short-lived.** The challenge proves a password was
  accepted; the proof proves a code was. Neither is a session.
- A proof is spent on first use within the process that issued it. Behind
  several instances that check is best-effort — the worst case is a second
  session for someone who has just proved both factors.
- The plugin refuses to start if it cannot find the admin login route to
  protect. A security plugin that quietly fails to attach is worse than one that
  is obviously missing.

## Requirements

- Strapi `^5.0.0`
- Node `>=18`

## Licence

Dual-licensed: **GNU AGPL v3.0** ([LICENSE](LICENSE)) or a
[commercial licence](COMMERCIAL-LICENSE.md) from Tech Style Ltd.

Running it on your own Strapi is AGPL use and costs nothing. Embedding it in a
closed-source product, redistributing a modified version without publishing the
source, or offering it as a hosted service without the AGPL §13 source
requirement needs the commercial licence — **hello@tech-style.co**.
