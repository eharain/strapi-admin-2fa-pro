/**
 * Every call this plugin's pages make. Kept in one place so the paths are
 * written once, and so a rename on the server has one place to land.
 *
 * The admin API has no prefix of its own, so a plugin sits at `/<plugin-id>`:
 * these are `/two-factor/...`, not `/admin/two-factor/...`.
 */
const BASE = '/two-factor';

export const endpoints = {
  me: `${BASE}/me`,
  enroll: `${BASE}/me/enroll`,
  confirm: `${BASE}/me/confirm`,
  disable: `${BASE}/me/disable`,
  recoveryCodes: `${BASE}/me/recovery-codes`,

  administration: `${BASE}/administration`,
  settings: `${BASE}/administration/settings`,
  reset: (id) => `${BASE}/administration/admins/${id}/reset`,
  unlock: (id) => `${BASE}/administration/admins/${id}/unlock`,
  revokeSessions: `${BASE}/administration/sessions/revoke`,

  users: `${BASE}/administration/users`,
  user: (id) => `${BASE}/administration/users/${encodeURIComponent(id)}`,
  resetUser: (id) => `${BASE}/administration/users/${encodeURIComponent(id)}/reset`,
  unlockUser: (id) => `${BASE}/administration/users/${encodeURIComponent(id)}/unlock`,
};

export const permissions = {
  usersRead: [{ action: 'plugin::two-factor.users.read', subject: null }],
  usersManage: [{ action: 'plugin::two-factor.users.manage', subject: null }],
};

/** Whether a lockout is still running, from the timestamp the server sends. */
export const isLocked = (lockedUntil) => Boolean(lockedUntil) && new Date(lockedUntil) > new Date();

/** The admin fetch client wraps the body in `data`; so does this plugin. */
export const unwrap = (response) => response?.data?.data ?? null;

export const errorMessage = (error, fallback) =>
  error?.response?.data?.error?.message || error?.message || fallback;
