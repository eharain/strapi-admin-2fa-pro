'use strict';

const { getService } = require('./utils/plugin');

const RBAC_ACTIONS = [
  {
    section: 'settings',
    category: 'two-factor authentication',
    displayName: 'Read the policy',
    uid: 'settings.read',
    pluginName: 'two-factor',
  },
  {
    section: 'settings',
    category: 'two-factor authentication',
    displayName: 'Change the policy',
    uid: 'settings.update',
    pluginName: 'two-factor',
  },
  {
    section: 'settings',
    category: 'two-factor authentication',
    displayName: 'Manage other administrators',
    uid: 'admins.manage',
    pluginName: 'two-factor',
  },
];

module.exports = async ({ strapi }) => {
  await strapi.service('admin::permission').actionProvider.registerMany(RBAC_ACTIONS);

  // An app that pins enforcement in its config file has never been through the
  // Settings page, so nothing has recorded when enforcement began. Without that
  // the grace period counts from nowhere.
  await getService(strapi, 'policy').ensureEnforcementStamp();

  const settings = await getService(strapi, 'settings').get();
  strapi.log.info(
    `[two-factor] ready — admin: ${settings.admin.enforce}` +
      (settings.admin.enforceRoles.length ? ` (+ roles ${settings.admin.enforceRoles.join(', ')})` : '') +
      `, users: ${settings.users.enabled ? settings.users.enforce : 'off'}`
  );
};
