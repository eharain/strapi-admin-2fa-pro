# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.2.0] — 2026-09-20

### Added

- **`POST /me/verify`**, on both the admin and the content-API surface: check a
  code for whoever the token belongs to and change nothing else. It answers only
  about the caller, so there is no way to ask about another account.

  This is for an application that runs its own sign-in and wants this plugin to
  be the one place a second factor lives — a separate identity service, a
  step-up prompt before something dangerous, a re-authentication box. Without
  it, the only ways to check a code were the login challenge (which needs a
  challenge the plugin itself issued) and the endpoints that change something.

  The code is still spent on success and still counts towards the lockout on
  failure. "Changes nothing else" means no enrolment changes, not a free guess.

## [0.1.0] — 2026-09-20

First release.

### Added

- **Admin panel two-factor authentication.** `POST /admin/login` is gated by a
  route middleware that answers `401 TwoFactorRequiredError` with a signed
  challenge instead of letting a password alone mint a session. The sign-in is
  then replayed with a proof, and Strapi's own login handler runs untouched.
- **Enrolment with a QR code**, an `otpauth://` link that opens the
  authenticator app on a phone, and the setup key in text.
- **Forced enrolment at the login screen** when the policy requires a factor and
  the account has none — the QR arrives with the challenge, so there is no
  detour through a settings page.
- **Recovery codes** — ten single-use codes, shown once, keyed-hashed at rest.
- **Per-account lockout** after `maxAttempts` wrong codes, so guessing cannot be
  spread across IP addresses.
- **Policy**: optional or required, per-role enforcement, and a grace period.
  Settable in `config/plugins.js` and overridable from the Settings page.
- **Coverage table** of administrators and their enrolment state, with reset and
  unlock, and a "end every other admin session" action so a new policy applies
  immediately rather than when old sessions expire.
- **Users-permissions surface** — the same authenticator on `POST
  /api/auth/local`, with `/api/two-factor/...` endpoints for a site's own front
  end. Off by setting `users.enabled` to false.
- **RBAC actions** `plugin::two-factor.settings.read`, `.settings.update` and
  `.admins.manage`, which appear under Settings → Roles.
- Factor secrets encrypted with AES-256-GCM under an HKDF-derived key; challenge
  and proof tokens signed under a separate derivation of the same material.

### Notes

- The plugin refuses to start if it cannot find the admin login route to
  protect, rather than leaving the panel looking protected while it is not.
- A proof is spent on first use within the process that issued it; across
  several instances that check is best-effort.
