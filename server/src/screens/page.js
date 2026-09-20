'use strict';

/**
 * The hosted account pages, as one self-contained document.
 *
 * No build step and no dependencies, for the same reason the sign-in dialog has
 * none: this is the page somebody lands on when they cannot get in, and it has
 * to keep working across Strapi upgrades, through a CDN, with the admin bundle
 * nowhere in sight.
 *
 * Everything the page needs to know comes from `config`, which is settings the
 * administrator chose. It is injected as JSON and read once; nothing from it is
 * ever written into the document as HTML.
 */

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STYLES = `
:root {
  --surface: #ffffff;
  --page: #f6f6f9;
  --text: #32324d;
  --muted: #666687;
  --border: #dcdce4;
  --field: #ffffff;
  --primary: #4945ff;
  --primary-text: #ffffff;
  --danger: #d02b20;
  --danger-bg: #fcecea;
  --ok: #328048;
  --ok-bg: #eafbe7;
  --code-bg: #f6f6f9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface: #212134;
    --page: #181826;
    --text: #ffffff;
    --muted: #a5a5ba;
    --border: #4a4a6a;
    --field: #181826;
    --primary: #7b79ff;
    --danger: #ee5e52;
    --danger-bg: #3a1a18;
    --ok: #5cb176;
    --ok-bg: #12291c;
    --code-bg: #181826;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--page);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

main {
  width: 100%;
  max-width: 420px;
  background: var(--surface);
  border-radius: 4px;
  box-shadow: 0 2px 15px rgba(33, 33, 52, 0.12);
  padding: 32px;
}

.brand { text-align: center; margin-bottom: 24px; }
.brand img { max-height: 48px; max-width: 200px; }
.brand h1 { margin: 8px 0 0; font-size: 18px; font-weight: 600; }

h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
p.lede { margin: 0 0 20px; color: var(--muted); }

label { display: block; margin: 0 0 6px; font-size: 12px; font-weight: 600; }

input {
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 16px;
  font-size: 14px;
  font-family: inherit;
  color: var(--text);
  background: var(--field);
  border: 1px solid var(--border);
  border-radius: 4px;
}

input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }

input.code {
  font-size: 20px;
  letter-spacing: 4px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

button {
  width: 100%;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  color: var(--primary-text);
  background: var(--primary);
  border: 1px solid var(--primary);
  border-radius: 4px;
  cursor: pointer;
}

button[disabled] { opacity: 0.6; cursor: default; }
button.ghost { background: transparent; color: var(--text); border-color: var(--border); }
button.danger { background: transparent; color: var(--danger); border-color: var(--danger); }

.row { display: flex; gap: 8px; }
.row > button { flex: 1; }

.linkline { margin-top: 16px; text-align: center; }

a, button.link {
  width: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--primary);
  font-size: 13px;
  font-family: inherit;
  font-weight: 400;
  text-decoration: underline;
  cursor: pointer;
}

.note {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.note.error { color: var(--danger); background: var(--danger-bg); }
.note.ok { color: var(--ok); background: var(--ok-bg); }

.qr {
  display: block;
  margin: 0 auto 16px;
  width: 200px;
  height: 200px;
  padding: 8px;
  background: #ffffff;
  border-radius: 4px;
}

.secret, .codes {
  padding: 10px;
  margin: 0 0 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  background: var(--code-bg);
  border-radius: 4px;
  word-break: break-all;
}

.secret { text-align: center; letter-spacing: 1px; }
.codes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }

.status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
}

.status b { display: block; }
.status span { color: var(--muted); font-size: 13px; }

.pill {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--ok);
  background: var(--ok-bg);
}

.pill.off { color: var(--danger); background: var(--danger-bg); }

.hidden { display: none; }
`;

/**
 * The page's own script. Written as a string rather than a file because the
 * whole point is one document with nothing to fetch and nothing to build.
 */
const SCRIPT = `
(function () {
  var root = document.getElementById('view');
  // Read from a data attribute rather than an inline script: Strapi's default
  // security headers block inline script outright.
  var CONFIG = JSON.parse(root.getAttribute('data-config'));
  var API = CONFIG.base;
  var state = { jwt: null, challenge: null, enrolment: null, identifier: '', password: '' };

  var params = new URLSearchParams(window.location.search);

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === 'text') node.textContent = props[key];
      else if (key === 'class') node.className = props[key];
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function call(path, body, jwt) {
    return fetch(API + path, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        jwt ? { Authorization: 'Bearer ' + jwt } : {}
      ),
      body: JSON.stringify(body || {})
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (err) { payload = null; }
        return { status: response.status, ok: response.ok, payload: payload };
      });
    });
  }

  function get(path, jwt) {
    return fetch(API + path, { headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} })
      .then(function (response) {
        return response.json().then(function (payload) {
          return { status: response.status, ok: response.ok, payload: payload };
        });
      });
  }

  function messageOf(result, fallback) {
    return (result.payload && result.payload.error && result.payload.error.message) || fallback;
  }

  function render(nodes) {
    root.innerHTML = '';
    nodes.filter(Boolean).forEach(function (node) { root.appendChild(node); });
  }

  function note(text, kind) {
    return text ? el('p', { class: 'note ' + (kind || 'error'), text: text }) : null;
  }

  function busy(button, on, label) {
    button.disabled = on;
    button.textContent = on ? 'Please wait…' : label;
  }

  // ── sign in ──────────────────────────────────────────────────────────────
  function signIn(message) {
    var identifier = el('input', { id: 'identifier', type: 'text', autocomplete: 'username', value: state.identifier });
    var password = el('input', { id: 'password', type: 'password', autocomplete: 'current-password' });
    var submit = el('button', { type: 'submit', text: 'Sign in' });

    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      state.identifier = identifier.value.trim();
      state.password = password.value;
      if (!state.identifier || !state.password) return;

      busy(submit, true, 'Sign in');
      call('/two-factor/account/login', { identifier: state.identifier, password: state.password })
        .then(function (result) {
          busy(submit, false, 'Sign in');
          var twoFactor = result.payload && result.payload.error && result.payload.error.details
            && result.payload.error.details.twoFactor;

          if (twoFactor) {
            state.challenge = twoFactor.challenge;
            state.enrolment = twoFactor.enrolment || null;
            return twoFactor.enrolmentRequired ? enrol() : secondFactor(twoFactor);
          }
          if (!result.ok) return signIn(messageOf(result, 'That sign-in did not work'));
          return signedIn(result.payload.jwt);
        })
        .catch(function () {
          busy(submit, false, 'Sign in');
          signIn('Could not reach the server. Try again.');
        });
    } }, [
      note(message),
      el('h2', { text: 'Sign in' }),
      el('label', { for: 'identifier', text: 'Email or username' }),
      identifier,
      el('label', { for: 'password', text: 'Password' }),
      password,
      submit
    ]);

    render([
      form,
      CONFIG.allowPasswordReset
        ? el('p', { class: 'linkline' }, [
            el('button', { class: 'link', type: 'button', text: 'Forgot your password?', onclick: forgot })
          ])
        : null
    ]);
    identifier.focus();
  }

  // ── the second factor ────────────────────────────────────────────────────
  function secondFactor(twoFactor, message, recovery) {
    var code = el('input', {
      id: 'code',
      class: recovery ? '' : 'code',
      type: 'text',
      inputmode: recovery ? 'text' : 'numeric',
      autocomplete: 'one-time-code',
      placeholder: recovery ? 'XXXX-XXXX-XXXX' : '000000'
    });
    var submit = el('button', { type: 'submit', text: 'Verify' });

    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      if (!code.value.trim()) return;
      busy(submit, true, 'Verify');

      call('/two-factor/challenge/verify', { challenge: state.challenge, code: code.value.trim() })
        .then(function (result) {
          if (!result.ok) {
            busy(submit, false, 'Verify');
            return secondFactor(twoFactor, messageOf(result, 'That code is not valid'), recovery);
          }
          return finishSignIn(result.payload.data.proof, submit);
        })
        .catch(function () {
          busy(submit, false, 'Verify');
          secondFactor(twoFactor, 'Could not reach the server. Try again.', recovery);
        });
    } }, [
      note(message),
      el('h2', { text: 'Two-step verification' }),
      el('p', { class: 'lede', text: recovery
        ? 'Enter one of the recovery codes you saved.'
        : 'Enter the code from your authenticator app.' }),
      el('label', { for: 'code', text: recovery ? 'Recovery code' : 'Verification code' }),
      code,
      submit
    ]);

    render([
      form,
      el('p', { class: 'linkline' }, [
        twoFactor.recoveryAvailable
          ? el('button', { class: 'link', type: 'button',
              text: recovery ? 'Use my authenticator instead' : 'I do not have my authenticator',
              onclick: function () { secondFactor(twoFactor, null, !recovery); } })
          : null
      ]),
      el('p', { class: 'linkline' }, [
        el('button', { class: 'link', type: 'button', text: 'Start again', onclick: function () { signIn(); } })
      ])
    ]);
    code.focus();
  }

  // ── enrolment forced at sign-in ──────────────────────────────────────────
  function enrol(message) {
    var enrolment = state.enrolment;
    var code = el('input', { id: 'code', class: 'code', type: 'text', inputmode: 'numeric',
      autocomplete: 'one-time-code', placeholder: '000000' });
    var submit = el('button', { type: 'submit', text: 'Confirm' });

    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      if (!code.value.trim()) return;
      busy(submit, true, 'Confirm');

      call('/two-factor/challenge/confirm', { challenge: state.challenge, code: code.value.trim() })
        .then(function (result) {
          busy(submit, false, 'Confirm');
          if (!result.ok) return enrol(messageOf(result, 'That code is not valid'));
          return recoveryCodes(result.payload.data.recoveryCodes, function () {
            finishSignIn(result.payload.data.proof);
          });
        })
        .catch(function () {
          busy(submit, false, 'Confirm');
          enrol('Could not reach the server. Try again.');
        });
    } }, [
      note(message),
      el('h2', { text: 'Set up two-step verification' }),
      el('p', { class: 'lede', text: 'This account has to be protected with an authenticator app before it can sign in.' }),
      el('img', { class: 'qr', src: enrolment.qrDataUrl, alt: 'Authenticator setup QR code' }),
      touch() ? el('a', { href: enrolment.otpauthUri, text: 'Open in your authenticator app',
        style: 'display:block;text-align:center;margin-bottom:16px' }) : null,
      el('div', { class: 'secret', text: enrolment.secret }),
      el('label', { for: 'code', text: 'Code from the app' }),
      code,
      submit
    ]);

    render([form]);
    code.focus();
  }

  function recoveryCodes(codes, onDone) {
    render([
      el('h2', { text: 'Save your recovery codes' }),
      el('p', { class: 'lede', text: 'Each code works once, in place of your authenticator. Keep them somewhere other than your phone. They will not be shown again.' }),
      el('div', { class: 'codes' }, codes.map(function (value) { return el('span', { text: value }); })),
      el('div', { class: 'row' }, [
        el('button', { class: 'ghost', type: 'button', text: 'Copy', onclick: function () {
          if (navigator.clipboard) navigator.clipboard.writeText(codes.join('\\n'));
        } }),
        el('button', { type: 'button', text: 'I have saved them', onclick: onDone })
      ])
    ]);
  }

  function finishSignIn(proof, button) {
    return call('/two-factor/account/login', {
      identifier: state.identifier,
      password: state.password,
      twoFactorToken: proof
    }).then(function (result) {
      if (button) busy(button, false, 'Verify');
      if (!result.ok) return signIn(messageOf(result, 'That sign-in did not work'));
      return signedIn(result.payload.jwt);
    });
  }

  // ── forgot and reset ─────────────────────────────────────────────────────
  function forgot(message) {
    var email = el('input', { id: 'email', type: 'email', autocomplete: 'email' });
    var submit = el('button', { type: 'submit', text: 'Send the link' });

    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      if (!email.value.trim()) return;
      busy(submit, true, 'Send the link');

      call('/two-factor/account/forgot-password', { email: email.value.trim() })
        .then(function (result) {
          busy(submit, false, 'Send the link');
          if (!result.ok) return forgot(messageOf(result, 'That did not work'));
          render([
            el('h2', { text: 'Check your email' }),
            el('p', { class: 'lede', text: 'If that address has an account, a link to set a new password is on its way. The link expires, so use it soon.' }),
            el('button', { type: 'button', text: 'Back to sign in', onclick: function () { signIn(); } })
          ]);
        })
        .catch(function () {
          busy(submit, false, 'Send the link');
          forgot('Could not reach the server. Try again.');
        });
    } }, [
      note(message),
      el('h2', { text: 'Forgot your password' }),
      el('p', { class: 'lede', text: 'We will email you a link to set a new one.' }),
      el('label', { for: 'email', text: 'Email address' }),
      email,
      submit
    ]);

    render([
      form,
      el('p', { class: 'linkline' }, [
        el('button', { class: 'link', type: 'button', text: 'Back to sign in', onclick: function () { signIn(); } })
      ])
    ]);
    email.focus();
  }

  function reset(code, message) {
    var password = el('input', { id: 'password', type: 'password', autocomplete: 'new-password' });
    var confirmation = el('input', { id: 'confirmation', type: 'password', autocomplete: 'new-password' });
    var submit = el('button', { type: 'submit', text: 'Set the password' });

    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      if (password.value !== confirmation.value) return reset(code, 'Those two passwords are not the same.');
      if (!password.value) return;
      busy(submit, true, 'Set the password');

      call('/two-factor/account/reset-password', {
        code: code,
        password: password.value,
        passwordConfirmation: confirmation.value
      })
        .then(function (result) {
          busy(submit, false, 'Set the password');
          if (!result.ok) return reset(code, messageOf(result, 'That link is no longer valid'));
          // A reset does not skip the second factor: sign in again as normal.
          history.replaceState(null, '', window.location.pathname);
          signIn('Your password is set. Sign in with it.');
        })
        .catch(function () {
          busy(submit, false, 'Set the password');
          reset(code, 'Could not reach the server. Try again.');
        });
    } }, [
      note(message),
      el('h2', { text: 'Set a new password' }),
      el('label', { for: 'password', text: 'New password' }),
      password,
      el('label', { for: 'confirmation', text: 'New password again' }),
      confirmation,
      submit
    ]);

    render([form]);
    password.focus();
  }

  // ── signed in ────────────────────────────────────────────────────────────
  function signedIn(jwt) {
    state.jwt = jwt;
    state.password = '';

    if (CONFIG.redirect) return handOver(jwt);
    return account();
  }

  function handOver(jwt) {
    render([
      el('h2', { text: 'Signing you in' }),
      el('p', { class: 'lede', text: 'Taking you back to ' + CONFIG.redirect.host + '…' })
    ]);
    // The fragment, not the query: it is not sent to the server and does not
    // land in a log or a Referer header.
    var target = CONFIG.redirect.uri + '#token=' + encodeURIComponent(jwt) +
      (CONFIG.redirect.state ? '&state=' + encodeURIComponent(CONFIG.redirect.state) : '');
    window.location.replace(target);
  }

  function account(message, kind) {
    get('/api/two-factor/me', state.jwt).then(function (result) {
      if (!result.ok) return signIn('Sign in again to continue.');
      var status = result.payload.data;

      render([
        note(message, kind),
        el('h2', { text: 'Your account' }),
        el('div', { class: 'status' }, [
          el('div', {}, [
            el('b', { text: 'Two-step verification' }),
            el('span', { text: status.enrolled
              ? (status.recoveryCodesRemaining + ' recovery code' + (status.recoveryCodesRemaining === 1 ? '' : 's') + ' left')
              : 'Your password is the only thing protecting this account.' })
          ]),
          el('span', { class: 'pill' + (status.enrolled ? '' : ' off'), text: status.enrolled ? 'On' : 'Off' })
        ]),

        status.enrolled ? null : el('button', { type: 'button', text: 'Set up two-step verification', onclick: startEnrolment }),
        status.enrolled ? el('div', { class: 'row' }, [
          el('button', { class: 'ghost', type: 'button', text: 'New recovery codes', onclick: function () { askCode('recovery-codes'); } }),
          status.required ? null : el('button', { class: 'danger', type: 'button', text: 'Turn off', onclick: function () { askCode('disable'); } })
        ]) : null,

        el('p', { class: 'linkline' }, [
          el('button', { class: 'link', type: 'button', text: 'Sign out', onclick: function () {
            state.jwt = null;
            signIn('You are signed out.');
          } })
        ])
      ]);
    });
  }

  function startEnrolment() {
    call('/api/two-factor/me/enroll', {}, state.jwt).then(function (result) {
      if (!result.ok) return account(messageOf(result, 'That did not work'));
      var enrolment = result.payload.data;
      var code = el('input', { id: 'code', class: 'code', type: 'text', inputmode: 'numeric',
        autocomplete: 'one-time-code', placeholder: '000000' });
      var submit = el('button', { type: 'submit', text: 'Confirm' });

      render([
        el('form', { onsubmit: function (event) {
          event.preventDefault();
          busy(submit, true, 'Confirm');
          call('/api/two-factor/me/confirm', { code: code.value.trim() }, state.jwt).then(function (confirmed) {
            busy(submit, false, 'Confirm');
            if (!confirmed.ok) return account(messageOf(confirmed, 'That code is not valid'));
            recoveryCodes(confirmed.payload.data.recoveryCodes, function () {
              account('Two-step verification is on.', 'ok');
            });
          });
        } }, [
          el('h2', { text: 'Scan this with your authenticator app' }),
          el('img', { class: 'qr', src: enrolment.qrDataUrl, alt: 'Authenticator setup QR code' }),
          touch() ? el('a', { href: enrolment.otpauthUri, text: 'Open in your authenticator app',
            style: 'display:block;text-align:center;margin-bottom:16px' }) : null,
          el('div', { class: 'secret', text: enrolment.secret }),
          el('label', { for: 'code', text: 'Code from the app' }),
          code,
          submit
        ]),
        el('p', { class: 'linkline' }, [
          el('button', { class: 'link', type: 'button', text: 'Cancel', onclick: function () { account(); } })
        ])
      ]);
      code.focus();
    });
  }

  function askCode(action) {
    var code = el('input', { id: 'code', class: 'code', type: 'text', inputmode: 'numeric',
      autocomplete: 'one-time-code', placeholder: '000000' });
    var submit = el('button', { type: 'submit', text: 'Continue' });
    var endpoint = action === 'disable' ? '/api/two-factor/me/disable' : '/api/two-factor/me/recovery-codes';

    render([
      el('form', { onsubmit: function (event) {
        event.preventDefault();
        busy(submit, true, 'Continue');
        call(endpoint, { code: code.value.trim() }, state.jwt).then(function (result) {
          busy(submit, false, 'Continue');
          if (!result.ok) return account(messageOf(result, 'That code is not valid'));
          if (action === 'disable') return account('Two-step verification is off.', 'ok');
          return recoveryCodes(result.payload.data.recoveryCodes, function () {
            account('New recovery codes issued. The old ones no longer work.', 'ok');
          });
        });
      } }, [
        el('h2', { text: action === 'disable' ? 'Turn off two-step verification' : 'New recovery codes' }),
        el('p', { class: 'lede', text: action === 'disable'
          ? 'Your password would then be the only thing protecting this account. Enter a code to confirm it is you.'
          : 'A fresh set replaces the old one, so anything you wrote down before stops working.' }),
        el('label', { for: 'code', text: 'Code from the app' }),
        code,
        submit
      ]),
      el('p', { class: 'linkline' }, [
        el('button', { class: 'link', type: 'button', text: 'Cancel', onclick: function () { account(); } })
      ])
    ]);
    code.focus();
  }

  // Is the *primary* pointer a finger? maxTouchPoints is not the question: a
  // laptop with a touchscreen reports ten of them and still wants a mouse, and
  // would be offered a link that opens nothing.
  function touch() {
    return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  // A reset link lands here with the code on it.
  var resetCode = params.get('code');
  if (resetCode) reset(resetCode);
  else signIn();
})();
`;

/**
 * Build the document. `config` is what the settings decided; `redirect` is the
 * application handover, already checked against the allow-list on the server —
 * the page is never the thing that decides where a token may go.
 *
 * Neither the script nor the styles are inline, and that is not a style
 * preference. Strapi's default security headers set `script-src 'self'`, which
 * blocks an inline script outright: the page would render its heading and then
 * do nothing at all, on every stock install. They are served as their own
 * same-origin routes instead, which the policy already allows. Relaxing the
 * headers for a sign-in page would be exactly the wrong trade.
 *
 * The configuration travels on a data attribute for the same reason.
 */
module.exports = function renderAccountPage({ base, title, logoUrl, allowPasswordReset, redirect }) {
  const pageConfig = { base, allowPasswordReset: Boolean(allowPasswordReset), redirect: redirect ?? null };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(base)}/two-factor/account/app.css">
</head>
<body>
<main>
  <div class="brand">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : ''}
    <h1>${escapeHtml(title)}</h1>
  </div>
  <div id="view" data-config="${escapeHtml(JSON.stringify(pageConfig))}"></div>
</main>
<script src="${escapeHtml(base)}/two-factor/account/app.js"></script>
</body>
</html>`;
};

module.exports.STYLES = STYLES;
module.exports.SCRIPT = SCRIPT;
