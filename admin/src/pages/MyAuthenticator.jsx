import React, { useCallback, useEffect, useState } from 'react';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Alert, Badge, Box, Button, Divider, Field, Flex, Loader, Typography } from '@strapi/design-system';

import { endpoints, errorMessage, unwrap } from '../api';

const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return Number(window.navigator?.maxTouchPoints) > 0;
};

/**
 * Everyone's own page: set up an authenticator, keep the recovery codes, take
 * it off again if the policy lets you.
 *
 * The same enrolment can also happen at the login screen when the policy forces
 * it — this page is where it happens by choice.
 */
const MyAuthenticator = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrolment, setEnrolment] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(unwrap(await get(endpoints.me)));
    } catch (error) {
      toggleNotification({ type: 'danger', message: errorMessage(error, 'Could not read your security settings') });
    } finally {
      setLoading(false);
    }
  }, [get, toggleNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (work, successMessage) => {
    setBusy(true);
    try {
      const result = await work();
      if (successMessage) toggleNotification({ type: 'success', message: successMessage });
      return result;
    } catch (error) {
      toggleNotification({ type: 'danger', message: errorMessage(error, 'That did not work') });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startEnrolment = () =>
    run(async () => {
      setEnrolment(unwrap(await post(endpoints.enroll, {})));
      setRecoveryCodes(null);
      setCode('');
    });

  const confirmEnrolment = () =>
    run(async () => {
      const result = unwrap(await post(endpoints.confirm, { code: code.trim() }));
      setRecoveryCodes(result.recoveryCodes);
      setEnrolment(null);
      setCode('');
      await load();
    }, 'Two-step verification is on');

  const disable = () =>
    run(async () => {
      await post(endpoints.disable, { code: code.trim() });
      setCode('');
      setRecoveryCodes(null);
      await load();
    }, 'Two-step verification is off');

  const newRecoveryCodes = () =>
    run(async () => {
      const result = unwrap(await post(endpoints.recoveryCodes, { code: code.trim() }));
      setRecoveryCodes(result.recoveryCodes);
      setCode('');
    }, 'New recovery codes issued — the old ones no longer work');

  if (loading) {
    return (
      <Page.Main>
        <Flex justifyContent="center" padding={10}>
          <Loader>Loading</Loader>
        </Flex>
      </Page.Main>
    );
  }

  const codeField = (label, onSubmit, action, disabled) => (
    <Flex gap={2} alignItems="flex-end" wrap="wrap">
      <Box width="220px">
        <Field.Root name="code">
          <Field.Label>{label}</Field.Label>
          <Field.Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            autoComplete="one-time-code"
          />
        </Field.Root>
      </Box>
      <Button onClick={onSubmit} loading={busy} disabled={disabled || code.trim() === ''}>
        {action}
      </Button>
    </Flex>
  );

  return (
    <Page.Main>
      <Layouts.Header
        title="My authenticator"
        subtitle="A code from your phone, on top of your password, whenever you sign in"
      />

      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          {status.mustEnrol || status.shouldEnrol ? (
            <Alert
              variant={status.mustEnrol ? 'danger' : 'warning'}
              title={status.mustEnrol ? 'Required for your account' : 'Required soon'}
              closeLabel="Close"
            >
              {status.mustEnrol
                ? 'You will be asked to set this up the next time you sign in.'
                : `Set this up before ${new Date(status.graceEndsAt).toLocaleDateString()}.`}
            </Alert>
          ) : null}

          <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
            <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography variant="delta">
                  Two-step verification is {status.enrolled ? 'on' : 'off'}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {status.enrolled
                    ? `Set up ${new Date(status.confirmedAt).toLocaleDateString()}` +
                      (status.lastUsedAt
                        ? ` · last used ${new Date(status.lastUsedAt).toLocaleString()}`
                        : '') +
                      ` · ${status.recoveryCodesRemaining} recovery code${
                        status.recoveryCodesRemaining === 1 ? '' : 's'
                      } left`
                    : 'Your password is the only thing protecting this account.'}
                </Typography>
              </Flex>
              <Badge backgroundColor={status.enrolled ? 'success100' : 'danger100'}>
                {status.enrolled ? 'Protected' : 'Password only'}
              </Badge>
            </Flex>

            {!status.enrolled && !enrolment ? (
              <Box paddingTop={4}>
                <Button onClick={startEnrolment} loading={busy}>
                  Set up two-step verification
                </Button>
              </Box>
            ) : null}
          </Box>

          {enrolment ? (
            <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
              <Typography variant="delta">Scan this with your authenticator app</Typography>
              <Box paddingTop={2} paddingBottom={4}>
                <Typography variant="pi" textColor="neutral600">
                  Google Authenticator, 1Password, Bitwarden, Authy — any of them will do.
                </Typography>
              </Box>

              <Flex gap={6} alignItems="flex-start" wrap="wrap">
                <Box background="neutral0" hasRadius>
                  <img
                    src={enrolment.qrDataUrl}
                    alt="Authenticator setup QR code"
                    width="200"
                    height="200"
                    style={{ display: 'block', background: '#ffffff', padding: 8, borderRadius: 4 }}
                  />
                </Box>

                <Flex direction="column" alignItems="flex-start" gap={3} flex="1" minWidth="260px">
                  {isTouchDevice() ? (
                    <Button
                      tag="a"
                      href={enrolment.otpauthUri}
                      variant="secondary"
                      onClick={() => {
                        /* the href does the work; the app takes over from here */
                      }}
                    >
                      Open in your authenticator app
                    </Button>
                  ) : null}

                  <Box>
                    <Typography variant="sigma" textColor="neutral600">
                      Or enter this key by hand
                    </Typography>
                    <Box paddingTop={1}>
                      <Typography variant="omega" fontWeight="bold" style={{ wordBreak: 'break-all' }}>
                        {enrolment.secret}
                      </Typography>
                    </Box>
                  </Box>

                  <Divider />

                  {codeField('Code from the app', confirmEnrolment, 'Confirm', false)}
                </Flex>
              </Flex>
            </Box>
          ) : null}

          {recoveryCodes ? (
            <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
              <Typography variant="delta">Your recovery codes</Typography>
              <Box paddingTop={2} paddingBottom={4}>
                <Typography variant="pi" textColor="neutral600">
                  Each one works once, in place of your authenticator. Keep them somewhere other than the
                  phone you just set up. They will not be shown again.
                </Typography>
              </Box>
              <Box background="neutral100" padding={4} hasRadius>
                <Flex direction="column" alignItems="flex-start" gap={1}>
                  {recoveryCodes.map((recoveryCode) => (
                    <Typography key={recoveryCode} variant="omega" fontWeight="bold">
                      {recoveryCode}
                    </Typography>
                  ))}
                </Flex>
              </Box>
              <Box paddingTop={4}>
                <Button
                  variant="tertiary"
                  onClick={() => {
                    window.navigator?.clipboard?.writeText(recoveryCodes.join('\n')).catch(() => {});
                    toggleNotification({ type: 'success', message: 'Copied' });
                  }}
                >
                  Copy
                </Button>
              </Box>
            </Box>
          ) : null}

          {status.enrolled ? (
            <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
              <Typography variant="delta">Recovery codes</Typography>
              <Box paddingTop={2} paddingBottom={4}>
                <Typography variant="pi" textColor="neutral600">
                  A fresh set replaces the old one, so anything you wrote down before stops working. Enter a
                  code from your app to prove it is you.
                </Typography>
              </Box>
              {codeField('Code from the app', newRecoveryCodes, 'Issue new codes', false)}

              <Box paddingTop={6}>
                <Divider />
              </Box>

              <Box paddingTop={6}>
                <Typography variant="delta">Turn it off</Typography>
                <Box paddingTop={2} paddingBottom={4}>
                  <Typography variant="pi" textColor="neutral600">
                    {status.required
                      ? 'Your role requires two-step verification, so it cannot be switched off here. An administrator can reset it if you have lost your device.'
                      : 'Your password would then be the only thing protecting this account.'}
                  </Typography>
                </Box>
                {status.required
                  ? null
                  : codeField('Code from the app', disable, 'Turn off two-step verification', false)}
              </Box>
            </Box>
          ) : null}
        </Flex>
      </Layouts.Content>
    </Page.Main>
  );
};

export default MyAuthenticator;
