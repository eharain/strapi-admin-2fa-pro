import React from 'react';
import { createRoot } from 'react-dom/client';

import ChallengeDialog from './components/ChallengeDialog';
import { injectDialogStyles } from './components/dialog-styles';

const LOGIN_PATH = '/admin/login';

/**
 * The admin panel's login screen belongs to Strapi: `auth/:authType` is one of
 * the routes plugins are explicitly not allowed to touch, so there is nowhere
 * to add a "enter your code" step by registering a route.
 *
 * What a plugin *can* do is sit on the call. Every request the panel makes goes
 * through `fetch`, so this wraps it, watches for the sign-in call, and when the
 * server answers "second factor first" it opens the prompt, gets a proof, and
 * replays the same sign-in with the proof attached. What the panel's own code
 * sees is one `fetch` that took longer than usual and then succeeded — no
 * patched components, no forked login page, nothing that breaks when Strapi
 * redesigns that screen.
 *
 * Every other request is handed to the original `fetch` untouched.
 */
const urlOf = (input) => {
  try {
    if (typeof input === 'string') return new URL(input, window.location.origin);
    if (typeof URL !== 'undefined' && input instanceof URL) return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  } catch {
    /* an unparseable URL is not our sign-in call */
  }
  return null;
};

const methodOf = (input, init) => {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
};

const present = (twoFactor, apiBase) =>
  new Promise((resolve) => {
    injectDialogStyles();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    const done = (result) => {
      // Unmounting from inside the dialog's own event handler would tear the
      // tree down mid-render; let the current pass finish first.
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 0);
      resolve(result);
    };

    root.render(<ChallengeDialog twoFactor={twoFactor} apiBase={apiBase} onDone={done} />);
  });

export const installLoginGate = () => {
  if (typeof window === 'undefined' || window.__twoFactorLoginGate) return;

  const original = window.fetch.bind(window);
  window.__twoFactorLoginGate = true;

  window.fetch = async function twoFactorFetch(input, init) {
    const url = urlOf(input);

    if (methodOf(input, init) !== 'POST' || !url || !url.pathname.endsWith(LOGIN_PATH)) {
      return original(input, init);
    }

    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    // A Request body can only be read once, and the call below reads it, so the
    // copy for the replay has to be taken now.
    const replay = isRequest ? input.clone() : null;

    const response = await original(input, init);
    if (response.status !== 401) return response;

    const payload = await response
      .clone()
      .json()
      .catch(() => null);

    const twoFactor = payload?.error?.details?.twoFactor;
    if (!twoFactor?.challenge) return response;

    const apiBase = `${url.origin}${url.pathname.slice(0, -LOGIN_PATH.length)}`;

    const outcome = await present(twoFactor, apiBase);
    // Cancelled: hand back the original refusal so the login form says something.
    if (!outcome) return response;

    const bodyText = isRequest ? await replay.text() : typeof init?.body === 'string' ? init.body : null;
    if (bodyText === null) return response;

    let credentials;
    try {
      credentials = JSON.parse(bodyText);
    } catch {
      return response;
    }

    const retryBody = JSON.stringify({ ...credentials, twoFactorToken: outcome.proof });

    if (isRequest) {
      const headers = new Headers(input.headers);
      headers.set('Content-Type', 'application/json');
      return original(
        new Request(input.url, {
          method: 'POST',
          headers,
          body: retryBody,
          credentials: input.credentials,
          mode: input.mode,
        })
      );
    }

    const headers = new Headers(init?.headers || {});
    headers.set('Content-Type', 'application/json');
    return original(input, { ...init, method: 'POST', headers, body: retryBody });
  };
};
