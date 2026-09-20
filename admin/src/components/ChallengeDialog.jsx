import React, { useEffect, useRef, useState } from 'react';

import { resolveTheme } from './dialog-styles';

// Is the *primary* pointer a finger? `maxTouchPoints` is not the question: a
// laptop with a touchscreen reports ten of them and still wants a mouse, and
// would be shown a link that opens nothing.
const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

const messageFrom = async (response, fallback) => {
  try {
    const payload = await response.json();
    return payload?.error?.message || fallback;
  } catch {
    return fallback;
  }
};

/**
 * The prompt that stands between a correct password and a session.
 *
 * It has three faces, and which one it opens on is decided by the server:
 *
 *   - **code** — the usual one. Someone with an authenticator types the code.
 *   - **enrol** — the account is required to use a second factor and has not
 *     set one up. The QR arrives with the challenge, so this is not a detour
 *     through a settings page; they scan, confirm, and are signed in.
 *   - **codes** — the recovery codes, shown once, after an enrolment.
 *
 * `onDone` receives the proof the sign-in is replayed with, or null if the
 * person backed out.
 */
const ChallengeDialog = ({ twoFactor, apiBase, onDone }) => {
  const [stage, setStage] = useState(twoFactor.enrolmentRequired ? 'enrol' : 'code');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [proof, setProof] = useState(null);

  const inputRef = useRef(null);
  const theme = useRef(resolveTheme()).current;
  const enrolment = twoFactor.enrolment;

  useEffect(() => {
    if (stage !== 'codes') inputRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onDone(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onDone]);

  const submit = async (event) => {
    event?.preventDefault();
    if (busy || code.trim() === '') return;

    setBusy(true);
    setError(null);

    const endpoint = stage === 'enrol' ? 'confirm' : 'verify';

    try {
      const response = await window.fetch(`${apiBase}/two-factor/challenge/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge: twoFactor.challenge, code: code.trim() }),
      });

      if (!response.ok) {
        setError(await messageFrom(response, 'That code is not valid'));
        setCode('');
        setBusy(false);
        inputRef.current?.focus();
        return;
      }

      const { data } = await response.json();

      if (data.recoveryCodes?.length) {
        // Shown exactly once. Signing in waits until they have been seen.
        setProof(data.proof);
        setRecoveryCodes(data.recoveryCodes);
        setStage('codes');
        setBusy(false);
        return;
      }

      onDone({ proof: data.proof });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  const title =
    stage === 'codes'
      ? 'Save your recovery codes'
      : stage === 'enrol'
        ? 'Set up your authenticator'
        : 'Two-step verification';

  return (
    <div className="t2fa-overlay" data-theme={theme} role="dialog" aria-modal="true" aria-label={title}>
      <div className="t2fa-card">
        <h2 className="t2fa-title">{title}</h2>

        {stage === 'codes' ? (
          <>
            <p className="t2fa-lede">
              Each code works once, in place of your authenticator. Keep them somewhere other than the phone
              you just set up — they are the way back in if you lose it. They will not be shown again.
            </p>
            <div className="t2fa-codes">
              {recoveryCodes.map((recoveryCode) => (
                <span key={recoveryCode}>{recoveryCode}</span>
              ))}
            </div>
            <div className="t2fa-actions">
              <button
                type="button"
                className="t2fa-button"
                data-variant="ghost"
                onClick={() => {
                  window.navigator?.clipboard?.writeText(recoveryCodes.join('\n')).catch(() => {});
                }}
              >
                Copy
              </button>
              <button type="button" className="t2fa-button" onClick={() => onDone({ proof })}>
                I have saved them
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            {error ? <p className="t2fa-error">{error}</p> : null}

            {stage === 'enrol' ? (
              <>
                <p className="t2fa-lede">
                  This account has to be protected with an authenticator app before it can sign in.
                </p>
                <ol className="t2fa-steps">
                  <li>Open your authenticator app.</li>
                  <li>Scan this code, or tap the button below on a phone.</li>
                  <li>Enter the six digits it shows.</li>
                </ol>
                <img className="t2fa-qr" src={enrolment.qrDataUrl} alt="Authenticator setup QR code" />
                {isTouchDevice() ? (
                  <a className="t2fa-open-app" href={enrolment.otpauthUri}>
                    Open in your authenticator app
                  </a>
                ) : null}
                <code className="t2fa-secret">{enrolment.secret}</code>
              </>
            ) : (
              <p className="t2fa-lede">
                {usingRecovery
                  ? 'Enter one of the recovery codes you saved when you set this up.'
                  : 'Enter the code from your authenticator app.'}
              </p>
            )}

            <label className="t2fa-label" htmlFor="t2fa-code">
              {usingRecovery ? 'Recovery code' : 'Verification code'}
            </label>
            <input
              id="t2fa-code"
              ref={inputRef}
              className="t2fa-input"
              data-recovery={usingRecovery ? 'true' : 'false'}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={usingRecovery ? 'text' : 'numeric'}
              placeholder={usingRecovery ? 'XXXX-XXXX-XXXX' : '000000'}
              disabled={busy}
            />

            <div className="t2fa-actions">
              <button
                type="button"
                className="t2fa-button"
                data-variant="ghost"
                onClick={() => onDone(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="t2fa-button" disabled={busy || code.trim() === ''}>
                {busy ? 'Checking…' : stage === 'enrol' ? 'Confirm' : 'Verify'}
              </button>
            </div>

            {stage === 'code' && twoFactor.recoveryAvailable ? (
              <button
                type="button"
                className="t2fa-link"
                onClick={() => {
                  setUsingRecovery(!usingRecovery);
                  setCode('');
                  setError(null);
                  inputRef.current?.focus();
                }}
              >
                {usingRecovery ? 'Use my authenticator instead' : 'I do not have my authenticator'}
              </button>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
};

export default ChallengeDialog;
