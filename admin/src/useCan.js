import { useAuth } from '@strapi/strapi/admin';

/**
 * Whether the signed-in administrator holds an action.
 *
 * Not `useRBAC`, and for a reason that only shows on a reload. The panel mounts
 * a page before it has fetched the administrator's permissions, and `useRBAC`
 * checks once, on mount, against whatever it has then — an empty list — and
 * only checks again if the *requested* permissions change. So a page opened by
 * reloading its URL, or from a bookmark, kept the answer "no" for as long as it
 * stayed open: the Website accounts page showed no Reset buttons to an
 * administrator who was allowed to use them.
 *
 * Reading the permissions straight from the auth state re-renders when they
 * arrive. Our actions carry no conditions, so there is nothing `useRBAC` would
 * have added. And this only decides which buttons to show: the server checks
 * every request regardless.
 */
const useCan = (...actions) => {
  const held = useAuth('two-factor', (state) => state.permissions) ?? [];
  return actions.map((action) => held.some((permission) => permission.action === action));
};

export default useCan;
