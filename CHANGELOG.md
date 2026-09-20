# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.5.0] — 2026-09-20

### Fixed

- **Every `/api/two-factor/me` call refused the person it exists for.** The
  users-permissions surface — status, enrolment, confirmation, verification,
  recovery codes — answered `401 "Sign in first"` on a perfectly valid token,
  so an account could never set up an authenticator, and a service using this
  as its factor store was told to sign in again forever.

  Those routes carry `auth: false`, written believing it meant "no
  *permission* is needed, but Strapi still authenticates the caller". It does
  not: `@strapi/core`'s auth service returns before any strategy runs when a
  route's `auth` is false, so `ctx.state.user` was never filled. Confirmed
  against Strapi 5.51.

  `auth: false` stays — a site should not have to grant permissions in the
  roles screen before its own people can protect their accounts — and the
  bearer is now read by the plugin itself (`gates/signed-in.js`) with the same
  users-permissions JWT service that issued it. It only ever adds the identity
  the token names: no token, a forged or expired one, a blocked account, or one
  that has been deleted all stay nobody, which the controllers already refuse.

  **The admin panel was never affected** — its routes use
  `admin::isAuthenticatedAdmin`, and that strategy does run.

## [0.4.1] — 2026-09-20

### Fixed

- **The repository, issues and homepage links pointed at an account that is not
  ours.** `github.com/tech-style` belongs to somebody else, so the package page
  sent people to a stranger's profile and resolved this README's images against
  it. They point at `github.com/eharain/strapi-admin-2fa-pro`, which is where
  the source actually is.

  No code changed. The commercial licence and security contact still read
  tech-style.co, which is the company's own domain and is correct.

## [0.4.0] — 2026-09-20

### Security

- **An SSO sign-in went round the second factor.** The password sign-in is
  gated at `POST /api/auth/local`, but signing in through a provider is a
  different route — `GET /api/auth/:provider/callback` — on the same
  controller, and it mints a token of its own. On any site with both an
  authenticator and a provider enabled, anyone who could get through the
  provider was inside, code or no code.

  It is gated now. It has to work the other way up from the password gate: the
  provider decides who this is *inside* the handler, so the handler runs and
  what it produced is taken back — the token is removed from the response,
  every cookie it set is dropped, and the refresh session it opened is
  invalidated — and the ordinary challenge goes back instead.

  A challenge raised this way is marked as such, because completing it returns
  a session directly: unlike the password flow there is no sign-in to replay.
  Only a challenge the provider gate signed can do that.

  **If you run this plugin with users-permissions SSO providers enabled,
  upgrade.** If you do not use providers, nothing here affects you.

### Added

- **Create an account**, with the "check your email" step, the confirmation
  link landing page and a resend. Two switches have to be on: the plugin's
  `screens.allowRegistration` and users-permissions' own `allow_register`, so
  turning the plugin's on does not open registration on a site that closed it.
  Confirming an address deliberately does **not** hand out a session — that
  would have been a third way past the second factor.
- **Change your password** while signed in, on the account page, through
  users-permissions' own `changePassword` so your password rules still apply.
- **Provider sign-in buttons** for whichever SSO providers users-permissions
  has enabled, read from its own store. A provider sign-in now asks for the
  second factor like any other.

## [0.3.0] — 2026-09-20

### Added

- **Hosted account pages** at `/two-factor/account`, for a site whose people
  sign in through users-permissions: sign in with the second factor built in,
  forgot and reset password, and a page where somebody sets up, replaces or
  removes their own authenticator. One self-contained document — no build step,
  no dependencies, light and dark.

  Sign-in, forgot and reset call users-permissions' **own controller**, so they
  send exactly the email the site is already configured to send and keep working
  where `/api/auth/*` has been closed off. The second factor is the same gate
  the API uses, not a second copy of it.

- **Signing an application in.** `/two-factor/account?redirect_uri=…&state=…`
  hands the token back in the URL fragment, so an application can use these
  pages instead of building its own sign-in. The return address is checked
  against `screens.redirectOrigins` **on the server** — the page never decides
  where a token may go — and an address that is not on the list is refused
  loudly rather than quietly ignored.

- Settings for all of it under **Settings → Two-factor authentication →
  Policy**: whether the pages are served at all, the heading and logo, whether
  password reset is offered, and the allowed origins.

### Fixed

- **The Policy page never loaded.** `strapi.db.query()` passes `limit: -1`
  straight to the database, which refuses a negative `LIMIT`, so
  `GET /two-factor/administration` answered 500 and the page showed "Internal
  Server Error". Leaving the limit out is what returns every row. The same
  mistake was in "end all other sessions".

  Nothing about signing in was affected, which is exactly why it survived: every
  end-to-end check of the second factor passed while this screen was broken.
  There is a check for it in [docs/verifying.md](docs/verifying.md) now.

- **The "open in your authenticator app" link showed on desktops.** It was
  offered whenever `navigator.maxTouchPoints > 0`, and a laptop with a
  touchscreen reports ten — so it appeared beside the QR on machines where it
  opens nothing. It now asks whether the *primary* pointer is a finger.

### Notes

- The pages are **off by default** and answer 404 until switched on. Installing
  a plugin should not put a sign-in page on the internet.
- They are served with `X-Frame-Options: DENY`, `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`, and are marked `noindex`.
- Neither the page's script nor its styles are inline. Strapi's default
  `script-src 'self'` blocks inline script, so an inline version rendered its
  heading and then did nothing at all. They are served as their own same-origin
  files, which the policy already allows — relaxing the headers on a sign-in
  page would have been the wrong way round.
- `npm run screenshots` captures [docs/screenshots](docs/screenshots) from a
  running instance, with stubbed API answers rather than a real account.

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
