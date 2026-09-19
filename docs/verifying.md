# Verifying an install

The unit tests cover the parts that can be checked in isolation — the crypto,
the tokens, the TOTP behaviour around replay and drift. What they cannot cover
is the thing that matters most: that a password on its own no longer gets into
the admin panel of *your* Strapi.

This is how to check that, against a running instance.

## Does it say it is there?

On boot the plugin logs one line:

```
info: [two-factor] ready — admin: optional, users: optional
```

If that line is missing, the plugin is not loaded — check that it is in
`dependencies` and that `config/plugins.js` has not disabled it.

If the app refuses to start with a message about the admin login route, the
plugin could not find `POST /admin/login` to attach to. It stops rather than
leave the panel looking protected while it is not. That should only happen on a
Strapi version it has not seen; please open an issue.

## The exchange, from a terminal

Take an account you can afford to lock yourself out of. Strapi's admin login is
rate-limited to a handful of attempts in five minutes, so do this deliberately
rather than in a loop.

**1. Before enrolment, a password is enough.**

```bash
curl -s -X POST http://localhost:1337/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'
```

`200`, with `data.token`. Keep that token for the next two calls.

**2. Enrol.**

```bash
curl -s -X POST http://localhost:1337/two-factor/me/enroll \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

`data.secret`, `data.otpauthUri` and `data.qrDataUrl` come back. Put the secret
into an authenticator app, then confirm with the code it shows:

```bash
curl -s -X POST http://localhost:1337/two-factor/me/confirm \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"code":"123456"}'
```

Ten recovery codes come back. **Save them** — the rest of this can lock you out
otherwise.

**3. Now the password is not enough.**

Repeat the call from step 1. It should answer:

```
401  {"data":null,"error":{"status":401,"name":"TwoFactorRequiredError", …}}
```

The two things to look for: the status is `401`, and the body contains no
`token` anywhere. That is the whole claim of this plugin. If a token comes back,
the gate is not attached — stop and open an issue.

**4. Pass the second factor and finish.**

```bash
curl -s -X POST http://localhost:1337/two-factor/challenge/verify \
  -H 'Content-Type: application/json' \
  -d '{"challenge":"<from step 3>","code":"123456"}'
```

`data.proof` comes back — and, again, no token. Replay the sign-in with it:

```bash
curl -s -X POST http://localhost:1337/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"...","twoFactorToken":"<proof>"}'
```

`200`, with the ordinary `data.token` and `data.user`. That response comes from
Strapi's own login handler, untouched.

## In the browser

Sign out and sign in again at `/admin`. After the password, the code prompt
appears over the login screen. There is no redirect and no second page — the
plugin holds the sign-in call open while you type.

Worth trying, because each is a path someone will eventually take:

- **Cancel the prompt.** You stay on the login screen with an error, not signed
  in.
- **"I do not have my authenticator."** The field takes a recovery code instead.
  Each one works once.
- **A wrong code, five times.** The account locks for fifteen minutes and says
  how long. Another administrator can clear it from Settings → Two-factor
  authentication → Policy → Unlock.

## Forced enrolment

Set **Settings → Two-factor authentication → Policy** to *Required*, save, and
sign in as an administrator who has not enrolled. The QR arrives on the login
screen itself; scanning it and entering the code both enrols the account and
completes the sign-in.

Administrators who are already signed in are not affected until their session
ends — that is what **End all other sessions** on the same page is for.

## Users-permissions accounts

Same shape against `/api/auth/local`, with `identifier` instead of `email` and
`/api/two-factor/...` for the challenge. A JWT is needed for the `/me`
endpoints; no role permissions have to be ticked.

## Cleaning up after a test

```sql
DELETE FROM two_factor_factors        WHERE subject_id = '<id>';
DELETE FROM two_factor_recovery_codes WHERE subject_id = '<id>';
```

That is also the way back in if every administrator is locked out at once.
