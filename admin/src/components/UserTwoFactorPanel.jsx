import React, { useCallback, useEffect, useState } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Badge, Box, Button, Flex, Loader, Typography } from '@strapi/design-system';

import { endpoints, errorMessage, isLocked, unwrap } from '../api';
import useCan from '../useCan';
import ConfirmWithCode from './ConfirmWithCode';

const USER_MODEL = 'plugin::users-permissions.user';

const date = (value) => (value ? new Date(value).toLocaleDateString() : null);
const time = (value) => (value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null);

const PanelBody = ({ documentId, canManage }) => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(null);

  const load = useCallback(async () => {
    try {
      setStatus(unwrap(await get(endpoints.user(documentId))));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [documentId, get]);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) {
    return (
      <Typography variant="pi" textColor="neutral600">
        Could not read this account’s second factor.
      </Typography>
    );
  }

  if (!status) {
    return <Loader small>Loading</Loader>;
  }

  const locked = isLocked(status.lockedUntil);
  const holdsSomething = status.enrolled || status.pendingEnrolment;

  const summary = locked
    ? `Locked out after too many wrong codes, until ${time(status.lockedUntil)}.`
    : status.enrolled
      ? `Set up ${date(status.confirmedAt)}` +
        (status.lastUsedAt ? `, last used ${date(status.lastUsedAt)}` : '') +
        ` · ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} left`
      : status.pendingEnrolment
        ? 'Started setting one up and did not finish.'
        : 'No authenticator. Their password is the only thing protecting this account.';

  const name = status.email || status.username || 'This account';

  return (
    <Flex direction="column" alignItems="stretch" gap={3} width="100%">
      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="omega" fontWeight="semiBold">
          Authenticator
        </Typography>
        <Badge backgroundColor={locked ? 'warning100' : status.enrolled ? 'success100' : 'neutral150'}>
          {locked ? 'Locked out' : status.enrolled ? 'On' : status.pendingEnrolment ? 'Half set up' : 'Off'}
        </Badge>
      </Flex>

      <Typography variant="pi" textColor="neutral600">
        {summary}
      </Typography>

      {canManage && holdsSomething ? (
        <Flex gap={2}>
          {locked ? (
            <Button size="S" variant="tertiary" onClick={() => setPending('unlock')}>
              Unlock
            </Button>
          ) : null}
          <Button size="S" variant="danger-light" onClick={() => setPending('reset')}>
            Reset authenticator
          </Button>
        </Flex>
      ) : null}

      <Box>
        <Typography variant="pi" textColor="neutral500">
          This is their sign-in to the site, not to this panel.
        </Typography>
      </Box>

      <ConfirmWithCode
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        danger={pending === 'reset'}
        title={pending === 'reset' ? 'Reset their authenticator' : 'Clear the lockout'}
        action={pending === 'reset' ? 'Reset' : 'Unlock'}
        offerSignOut={pending === 'reset'}
        signOutNote="Only possible where the site issues refresh sessions. A plain token stays valid until it expires."
        description={
          pending === 'reset'
            ? `${name} loses their authenticator and every recovery code, and sets a new one up at their next sign-in if one is required.`
            : `${name} keeps their authenticator and can try a code again straight away.`
        }
        onConfirm={async ({ code, endSessions }) => {
          const target =
            pending === 'reset' ? endpoints.resetUser(status.id) : endpoints.unlockUser(status.id);
          await post(target, { code, endSessions });
          toggleNotification({
            type: 'success',
            message: pending === 'reset' ? `${name} can set up an authenticator again.` : `${name} can try again.`,
          });
          await load();
        }}
      />
    </Flex>
  );
};

/**
 * A panel on a users-permissions account in the Content Manager, which is
 * where an administrator already is when somebody writes in to say they have
 * lost their phone. Shown only on that one content type, and only to people
 * who may see it.
 */
const UserTwoFactorPanel = ({ model, documentId }) => {
  const [canRead, canManage] = useCan('plugin::two-factor.users.read', 'plugin::two-factor.users.manage');

  if (model !== USER_MODEL || !documentId || !canRead) return null;

  return {
    title: 'Two-factor authentication',
    content: <PanelBody documentId={documentId} canManage={canManage} />,
  };
};

export default UserTwoFactorPanel;
