import React, { useEffect, useState } from 'react';
import { Box, Button, Checkbox, Field, Modal, Typography } from '@strapi/design-system';

import { errorMessage } from '../api';

/**
 * The one gate in front of every change to somebody else's second factor.
 *
 * It asks for a code from the *acting* administrator's own authenticator, not
 * the other person's: resetting a factor is the step an attacker holding an
 * administrator's password most wants, and this is what makes a password alone
 * not enough to take it. The server checks the code too — this dialog is where
 * it is asked for, not what enforces it.
 *
 * `offerSignOut` adds "also end their sessions", for a reset done because an
 * account may be compromised rather than because a phone was lost.
 *
 * `onConfirm({ code, endSessions })` should perform the change and throw on a
 * refusal; the refusal's own words are shown here, and the dialog stays open so
 * a mistyped code can simply be typed again.
 */
const ConfirmWithCode = ({
  open,
  title,
  description,
  action,
  danger = false,
  offerSignOut = false,
  signOutNote = null,
  onConfirm,
  onClose,
}) => {
  const [code, setCode] = useState('');
  const [endSessions, setEndSessions] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCode('');
      setEndSessions(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (event) => {
    event?.preventDefault();
    if (busy || code.trim() === '') return;

    setBusy(true);
    setError(null);
    try {
      await onConfirm({ code: code.trim(), endSessions });
      onClose();
    } catch (failure) {
      setError(errorMessage(failure, 'That did not work'));
      setCode('');
      setBusy(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={(next) => (!next && !busy ? onClose() : null)}>
      <Modal.Content>
        <form onSubmit={submit}>
          <Modal.Header>
            <Modal.Title>{title}</Modal.Title>
          </Modal.Header>

          <Modal.Body>
            <Box paddingBottom={4}>
              <Typography variant="omega">{description}</Typography>
            </Box>

            {error ? (
              <Box paddingBottom={4}>
                <Typography variant="omega" textColor="danger600">
                  {error}
                </Typography>
              </Box>
            ) : null}

            <Field.Root name="own-code" hint="From your own authenticator app, not theirs.">
              <Field.Label>Your code</Field.Label>
              <Field.Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                disabled={busy}
              />
              <Field.Hint />
            </Field.Root>

            {offerSignOut ? (
              <Box paddingTop={4}>
                <Checkbox checked={endSessions} onCheckedChange={(checked) => setEndSessions(Boolean(checked))}>
                  Also sign them out everywhere
                </Checkbox>
                {signOutNote ? (
                  <Box paddingTop={1} paddingLeft={6}>
                    <Typography variant="pi" textColor="neutral600">
                      {signOutNote}
                    </Typography>
                  </Box>
                ) : null}
              </Box>
            ) : null}
          </Modal.Body>

          <Modal.Footer>
            <Button variant="tertiary" onClick={onClose} disabled={busy} type="button">
              Cancel
            </Button>
            <Button
              variant={danger ? 'danger' : 'default'}
              type="submit"
              loading={busy}
              disabled={code.trim() === ''}
            >
              {action}
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ConfirmWithCode;
