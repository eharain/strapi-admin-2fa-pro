# Security policy

## Reporting a vulnerability

Email **hello@tech-style.co** with "strapi-admin-2fa-pro" in the subject. Please
do not open a public issue for anything exploitable.

Include what you can: the Strapi version, the plugin version, and the steps to
reproduce. You will get an acknowledgement within three working days.

## What this plugin is responsible for

It stands between a correct password and an admin session. Concretely, it
claims:

- `POST /admin/login` with a correct password and no second factor returns no
  token and sets no refresh cookie, for any account with a confirmed factor.
- A TOTP code is accepted once. The accepted time step is persisted and the same
  code inside its own window is refused as a replay.
- Wrong codes are counted against the account, not the caller's address, and the
  account locks after `maxAttempts`.
- Factor secrets are never returned after enrolment, and never logged.
- Challenge and proof tokens are signed, expire, and are bound to one account.

A report that breaks any of those is a vulnerability. So is anything that lets a
challenge or proof be minted without a correct password, or a factor be removed
without a live code.

## What it is not responsible for

- **Session lifetime after sign-in.** Once the second factor is passed, the
  session is Strapi's, with Strapi's lifetime and revocation. That is by design
  — the plugin does not mint tokens.
- **Password strength, reset flows and account lockout on the password.** Those
  are Strapi's.
- **An administrator who is already signed in** when a policy changes. The login
  gate meets people at the door. Ending existing sessions is a deliberate action
  on the Policy page, not something the plugin does behind your back.
- **A compromised server.** Factor secrets are encrypted at rest, but the key is
  derivable by the running application; an attacker with code execution and the
  key material can read them. Two-factor authentication raises the cost of a
  stolen password, not of a compromised host.

## Known limits, stated plainly

- **Proof single-use is per process.** A proof is marked spent in memory. Behind
  several instances without sticky routing, a proof could be replayed within its
  lifetime (two minutes by default) to open a second session — for an account
  that has just presented both factors. Lower `proofTtlSeconds` if that matters
  to you.
- **`admin.auth.secret` as key material.** If `encryptionKey` is not set and the
  plugin falls back to the admin JWT secret, rotating that secret makes every
  enrolled factor unreadable. It warns on boot when it is doing this.
- **TOTP is phishable.** A code typed into a convincing fake page can be relayed
  in real time. TOTP defeats stolen and reused passwords; it does not defeat a
  live adversary-in-the-middle. WebAuthn does, and is the direction this plugin
  should grow in.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

Strapi `^5.0.0`, Node `>=18`.
