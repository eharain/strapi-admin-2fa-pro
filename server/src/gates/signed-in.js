'use strict';

/**
 * Who is asking, on this plugin's own `/me` routes.
 *
 * Those routes carry `auth: false`, which was written believing it meant "no
 * *permission* is needed, but Strapi still runs its authentication strategies,
 * so a valid JWT lands in `ctx.state.user`". It does not. `@strapi/core`'s auth
 * service returns before any strategy runs:
 *
 *     const config = route?.config?.auth;
 *     if (config === false) { return next(); }
 *
 * So `ctx.state.user` was never set, and every `/api/two-factor/me/*` call
 * refused the person it exists for with "Sign in first" — enrolment included.
 * The admin surface was never affected: those routes use
 * `admin::isAuthenticatedAdmin`, and the admin strategy runs for them.
 *
 * Keeping `auth: false` is still the right call — a site should not have to
 * tick permissions in the roles screen before its own people can protect their
 * accounts — so the token is read here instead, with the same
 * users-permissions JWT service that issued it.
 *
 * This only ever ADDS identity, and only the token's own. Anyone without a
 * usable token is left as nobody, which is exactly what the controller already
 * refuses; a blocked account is nobody too, as it is on the login path.
 */
module.exports = ({ strapi }) => async (ctx, next) => {
  // An app that does authenticate these routes has already answered this.
  if (ctx.state.user) return next();

  const header = ctx.request?.header?.authorization || '';
  const [scheme, token] = String(header).split(/\s+/);
  if (!/^bearer$/i.test(scheme || '') || !token) return next();

  const users = strapi.plugin('users-permissions');
  if (!users) return next();

  let payload;
  try {
    payload = await users.service('jwt').verify(token);
  } catch {
    // Expired, forged, or signed with a rotated secret: nobody, without saying
    // which - the controller's refusal is the same either way.
    return next();
  }
  if (!payload?.id) return next();

  const user = await strapi.db
    .query('plugin::users-permissions.user')
    .findOne({ where: { id: payload.id } })
    .catch(() => null);
  if (!user || user.blocked) return next();

  ctx.state.user = user;
  return next();
};
