import React, { useCallback, useEffect, useState } from 'react';
import { Layouts, Page, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  Loader,
  Searchbar,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';

import { endpoints, errorMessage, isLocked, unwrap } from '../api';
import ConfirmWithCode from '../components/ConfirmWithCode';
import useCan from '../useCan';

const PAGE_SIZE = 25;

const when = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const stateOf = (row) => {
  if (isLocked(row.lockedUntil)) return { label: 'Locked out', color: 'warning100' };
  if (row.pendingEnrolment) return { label: 'Half set up', color: 'neutral150' };
  return { label: 'On', color: 'success100' };
};

/**
 * Website accounts that hold a second factor — the users-permissions accounts
 * people sign in to the site with, as opposed to this admin panel.
 *
 * The two are separate accounts with separate authenticators, and resetting
 * the wrong one is the mistake this page exists to make hard: somebody locked
 * out of the *site* is helped here, not on the Policy page's administrator
 * table.
 *
 * Only accounts that hold something are listed. There is no "look anybody up"
 * here: the list is of factors this plugin owns, and the search narrows it.
 */
const Users = () => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [canManage] = useCan('plugin::two-factor.users.manage');

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageCount: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await get(endpoints.users, { params: { search: query, page, pageSize: PAGE_SIZE } });
      setRows(unwrap(response) ?? []);
      setPagination(response?.data?.meta?.pagination ?? { page: 1, pageCount: 1, total: 0 });
    } catch (error) {
      toggleNotification({ type: 'danger', message: errorMessage(error, 'Could not read the accounts') });
    } finally {
      setLoading(false);
    }
  }, [get, page, query, toggleNotification]);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (row) => row.email || row.username || `Account ${row.id}`;

  const confirm = async ({ code, endSessions }) => {
    const { row, kind } = pending;
    const target = kind === 'reset' ? endpoints.resetUser(row.id) : endpoints.unlockUser(row.id);
    const response = await post(target, { code, endSessions });
    const result = unwrap(response) ?? {};

    toggleNotification({
      type: 'success',
      message:
        kind === 'reset'
          ? `${nameOf(row)} can set up an authenticator again.` +
            (endSessions ? (result.sessionsEnded ? ' Their sessions have ended.' : ' Their sessions could not be ended — see below.') : '')
          : `${nameOf(row)} can try their code again.`,
    });
    await load();
  };

  return (
    <Page.Main>
      <Layouts.Header
        title="Website accounts"
        subtitle="People who sign in to the site — not administrators of this panel, who have their own authenticators"
      />

      <Layouts.Content>
        <Flex direction="column" alignItems="stretch" gap={4}>
          <Box width="420px">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setQuery(search.trim());
              }}
            >
              <Searchbar
                name="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onClear={() => {
                  setSearch('');
                  setQuery('');
                  setPage(1);
                }}
                clearLabel="Clear the search"
                placeholder="Email or username"
              >
                Search by email or username
              </Searchbar>
            </form>
          </Box>

          <Box background="neutral0" shadow="tableShadow" hasRadius>
            {loading ? (
              <Flex justifyContent="center" padding={10}>
                <Loader>Loading</Loader>
              </Flex>
            ) : rows.length === 0 ? (
              <EmptyStateLayout
                content={
                  query
                    ? `No account matching “${query}” has an authenticator.`
                    : 'No website account has set up an authenticator yet.'
                }
              />
            ) : (
              <Table colCount={6} rowCount={rows.length}>
                <Thead>
                  <Tr>
                    <Th>
                      <Typography variant="sigma">Account</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Authenticator</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Set up</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Last used</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Recovery codes</Typography>
                    </Th>
                    <Th>
                      <Typography variant="sigma">Actions</Typography>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((row) => {
                    const state = stateOf(row);
                    return (
                      <Tr key={row.id}>
                        <Td>
                          <Flex direction="column" alignItems="flex-start">
                            <Typography>{row.missing ? 'Deleted account' : nameOf(row)}</Typography>
                            {row.username && row.email ? (
                              <Typography variant="pi" textColor="neutral600">
                                {row.username}
                              </Typography>
                            ) : null}
                          </Flex>
                        </Td>
                        <Td>
                          <Badge backgroundColor={state.color}>{state.label}</Badge>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">{when(row.confirmedAt)}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">{when(row.lastUsedAt)}</Typography>
                        </Td>
                        <Td>
                          <Typography textColor="neutral600">
                            {row.enrolled ? row.recoveryCodesRemaining : '—'}
                          </Typography>
                        </Td>
                        <Td>
                          {canManage ? (
                            <Flex gap={2}>
                              {isLocked(row.lockedUntil) ? (
                                <Button size="S" variant="tertiary" onClick={() => setPending({ row, kind: 'unlock' })}>
                                  Unlock
                                </Button>
                              ) : null}
                              <Button size="S" variant="danger-light" onClick={() => setPending({ row, kind: 'reset' })}>
                                Reset
                              </Button>
                            </Flex>
                          ) : (
                            <Typography variant="pi" textColor="neutral500">
                              —
                            </Typography>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </Box>

          {pagination.pageCount > 1 ? (
            <Flex justifyContent="space-between" alignItems="center">
              <Typography variant="pi" textColor="neutral600">
                {pagination.total} account{pagination.total === 1 ? '' : 's'} · page {pagination.page} of{' '}
                {pagination.pageCount}
              </Typography>
              <Flex gap={2}>
                <Button variant="tertiary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button
                  variant="tertiary"
                  disabled={page >= pagination.pageCount}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </Flex>
            </Flex>
          ) : null}
        </Flex>
      </Layouts.Content>

      <ConfirmWithCode
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        danger={pending?.kind === 'reset'}
        title={pending?.kind === 'reset' ? 'Reset their authenticator' : 'Clear the lockout'}
        action={pending?.kind === 'reset' ? 'Reset' : 'Unlock'}
        offerSignOut={pending?.kind === 'reset'}
        signOutNote="Only possible where the site issues refresh sessions. A plain token stays valid until it expires — nothing on the server can take it back."
        description={
          pending
            ? pending.kind === 'reset'
              ? `${nameOf(pending.row)} loses their authenticator and every recovery code. They set a new one up at their next sign-in if one is required, or from their account page.`
              : `${nameOf(pending.row)} keeps their authenticator and can try a code again straight away.`
            : ''
        }
      />
    </Page.Main>
  );
};

export default Users;
