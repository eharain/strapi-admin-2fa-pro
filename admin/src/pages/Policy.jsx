import React, { useCallback, useEffect, useState } from 'react';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Field,
  Flex,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';

import { endpoints, errorMessage, unwrap } from '../api';

/**
 * The policy, and who it currently covers.
 *
 * The coverage table is the point of the page: a policy that says "required"
 * while half the team has not enrolled is worth knowing about, and the only way
 * to know is to look.
 */
const Policy = () => {
  const { get, put, post } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [state, setState] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = unwrap(await get(endpoints.administration));
      setState(data);
      setDraft(data.settings);
    } catch (error) {
      toggleNotification({ type: 'danger', message: errorMessage(error, 'Could not read the policy') });
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
      await work();
      if (successMessage) toggleNotification({ type: 'success', message: successMessage });
    } catch (error) {
      toggleNotification({ type: 'danger', message: errorMessage(error, 'That did not work') });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await put(endpoints.settings, draft);
      await load();
    }, 'Policy saved');

  const reset = (admin) =>
    run(async () => {
      await post(endpoints.reset(admin.id), {});
      await load();
    }, 'Authenticator removed — they will be asked to set one up again');

  const unlock = (admin) =>
    run(async () => {
      await post(endpoints.unlock(admin.id), {});
      await load();
    }, 'Lockout cleared');

  const revokeSessions = () =>
    run(async () => {
      const response = await post(endpoints.revokeSessions, {});
      const { revoked } = unwrap(response) ?? {};
      toggleNotification({
        type: 'success',
        message: `Ended ${revoked} administrator session${revoked === 1 ? '' : 's'}`,
      });
    });

  if (loading || !draft) {
    return (
      <Page.Main>
        <Flex justifyContent="center" padding={10}>
          <Loader>Loading</Loader>
        </Flex>
      </Page.Main>
    );
  }

  const enforcing = draft.admin.enforce === 'required' || draft.admin.enforceRoles.length > 0;
  const uncovered = state.admins.filter((admin) => !admin.enrolled);

  const patch = (path, value) => {
    const [group, key] = path.split('.');
    setDraft({ ...draft, [group]: { ...draft[group], [key]: value } });
  };

  const toggleRole = (code, checked) => {
    const current = draft.admin.enforceRoles;
    patch('admin.enforceRoles', checked ? [...current, code] : current.filter((role) => role !== code));
  };

  return (
    <Page.Main>
      <Layouts.Header
        title="Two-factor authentication"
        subtitle="Who has to prove who they are with more than a password"
        primaryAction={
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        }
      />

      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={6}>
          {enforcing && uncovered.length > 0 ? (
            <Alert variant="warning" title="Not everyone is covered yet" closeLabel="Close">
              {uncovered.length} of {state.coverage.total} administrators have no authenticator. They will be
              asked to set one up the next time they sign in — sessions they already have are not affected
              until you end them.
            </Alert>
          ) : null}

          <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
            <Typography variant="delta">Administrators</Typography>
            <Box paddingTop={4}>
              <Flex gap={4} alignItems="flex-end" wrap="wrap">
                <Box width="260px">
                  <Field.Root name="admin-enforce">
                    <Field.Label>Second factor</Field.Label>
                    <SingleSelect
                      value={draft.admin.enforce}
                      onChange={(value) => patch('admin.enforce', value)}
                    >
                      <SingleSelectOption value="optional">
                        Optional — whoever sets one up uses it
                      </SingleSelectOption>
                      <SingleSelectOption value="required">
                        Required — everyone must set one up
                      </SingleSelectOption>
                    </SingleSelect>
                  </Field.Root>
                </Box>

                <Box width="200px">
                  <Field.Root name="grace" hint="Days before it is enforced">
                    <Field.Label>Grace period</Field.Label>
                    <Field.Input
                      type="number"
                      min="0"
                      max="365"
                      value={String(draft.admin.gracePeriodDays)}
                      onChange={(event) =>
                        patch('admin.gracePeriodDays', Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                    <Field.Hint />
                  </Field.Root>
                </Box>
              </Flex>
            </Box>

            <Box paddingTop={6}>
              <Typography variant="sigma" textColor="neutral600">
                Always required for these roles
              </Typography>
              <Box paddingTop={2}>
                <Flex direction="column" alignItems="flex-start" gap={2}>
                  {state.roles.map((role) => (
                    <Checkbox
                      key={role.id}
                      checked={draft.admin.enforceRoles.includes(role.code)}
                      onCheckedChange={(checked) => toggleRole(role.code, Boolean(checked))}
                    >
                      {role.name}
                    </Checkbox>
                  ))}
                </Flex>
              </Box>
            </Box>
          </Box>

          <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
            <Typography variant="delta">Website accounts</Typography>
            <Box paddingTop={2} paddingBottom={4}>
              <Typography variant="pi" textColor="neutral600">
                The same authenticator, on the users-permissions sign-in your front end uses. Turning it off
                leaves those accounts on a password alone, whatever they have already set up.
              </Typography>
            </Box>
            <Box width="300px">
              <Field.Root name="users-enforce">
                <Field.Label>Second factor</Field.Label>
                <SingleSelect
                  value={draft.users.enabled ? draft.users.enforce : 'off'}
                  onChange={(value) => {
                    if (value === 'off') {
                      setDraft({ ...draft, users: { ...draft.users, enabled: false } });
                      return;
                    }
                    setDraft({ ...draft, users: { enabled: true, enforce: value } });
                  }}
                >
                  <SingleSelectOption value="off">Off</SingleSelectOption>
                  <SingleSelectOption value="optional">
                    Optional — whoever sets one up uses it
                  </SingleSelectOption>
                  <SingleSelectOption value="required">
                    Required — everyone must set one up
                  </SingleSelectOption>
                </SingleSelect>
              </Field.Root>
            </Box>
          </Box>

          <Box background="neutral0" padding={6} shadow="tableShadow" hasRadius>
            <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
              <Flex direction="column" alignItems="flex-start" gap={1}>
                <Typography variant="delta">
                  Coverage — {state.coverage.enrolled} of {state.coverage.total}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  Ending other sessions makes a new policy apply today rather than whenever those sessions
                  expire. Yours is left alone.
                </Typography>
              </Flex>
              <Button variant="danger-light" onClick={revokeSessions} loading={busy}>
                End all other sessions
              </Button>
            </Flex>

            <Box paddingTop={4}>
              <Table colCount={4} rowCount={state.admins.length}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">Administrator</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Roles</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Authenticator</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Actions</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {state.admins.map((admin) => {
                    const locked = admin.lockedUntil && new Date(admin.lockedUntil) > new Date();
                    return (
                      <Tr key={admin.id}>
                        <Td>
                          <Typography>{admin.email}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">
                            {admin.roles.map((role) => role.name).join(', ') || '—'}
                          </Typography>
                        </Td>
                        <Td>
                          <Badge
                            backgroundColor={
                              locked ? 'warning100' : admin.enrolled ? 'success100' : 'danger100'
                            }
                          >
                            {locked ? 'Locked out' : admin.enrolled ? 'Set up' : 'None'}
                          </Badge>
                        </Td>
                        <Td>
                          <Flex gap={2}>
                            {locked ? (
                              <Button size="S" variant="tertiary" onClick={() => unlock(admin)} disabled={busy}>
                                Unlock
                              </Button>
                            ) : null}
                            {admin.enrolled ? (
                              <Button
                                size="S"
                                variant="danger-light"
                                onClick={() => reset(admin)}
                                disabled={busy}
                              >
                                Reset
                              </Button>
                            ) : null}
                          </Flex>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </Box>
          </Box>
        </Flex>
      </Layouts.Content>
    </Page.Main>
  );
};

export default Policy;
