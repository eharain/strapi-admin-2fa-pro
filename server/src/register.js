'use strict';

const adminLoginGate = require('./gates/admin-login');
const usersLoginGate = require('./gates/users-login');

/**
 * Wire the two gates into the two login routes.
 *
 * This happens in `register`, before `initRouting()` builds the router in
 * bootstrap, which is the only window in which a route's middleware list can
 * still be changed. Appending to `config.middlewares` puts the gate after the
 * route's own rate limiter and before its handler.
 *
 * If the admin login route cannot be found, this throws and the app does not
 * start. That is deliberate: a security plugin that quietly fails to attach is
 * worse than one that is obviously absent, because the panel would look
 * protected and would not be.
 */
const eachRouter = (routes) => {
  if (!routes) return [];
  if (Array.isArray(routes)) return [{ routes }];
  return Object.values(routes).filter((router) => router && Array.isArray(router.routes));
};

const findRoute = (routes, method, path) => {
  for (const router of eachRouter(routes)) {
    const match = router.routes.find(
      (route) => String(route.method).toUpperCase() === method && route.path === path
    );
    if (match) return match;
  }
  return null;
};

const attach = (route, middleware) => {
  route.config = route.config || {};
  route.config.middlewares = [...(route.config.middlewares || []), middleware];
};

module.exports = ({ strapi }) => {
  const adminLogin = findRoute(strapi.admin?.routes, 'POST', '/login');
  if (!adminLogin) {
    throw new Error(
      'two-factor: could not find the admin login route (POST /admin/login) to protect. The plugin will not ' +
        'start rather than leave the admin panel looking protected while it is not. This usually means the ' +
        'installed version of @strapi/admin has moved the route — please open an issue.'
    );
  }
  attach(adminLogin, adminLoginGate({ strapi }));

  // users-permissions is optional; an app without it simply has no second surface.
  const usersPlugin = strapi.plugins?.['users-permissions'];
  if (usersPlugin) {
    const usersLogin = findRoute(usersPlugin.routes, 'POST', '/auth/local');
    if (usersLogin) {
      attach(usersLogin, usersLoginGate({ strapi }));
    } else {
      strapi.log.warn(
        '[two-factor] users-permissions is installed but its POST /auth/local route was not found — ' +
          'two-factor authentication is protecting the admin panel only.'
      );
    }
  }
};
