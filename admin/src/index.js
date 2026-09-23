import { Lock } from '@strapi/icons';

import { permissions } from './api';
import UserTwoFactorPanel from './components/UserTwoFactorPanel';
import { installLoginGate } from './login-gate';
import pluginId from './pluginId';

export default {
  register(app) {
    // Before anything else: the sign-in screen is rendered by Strapi itself, so
    // the second-factor step has to be in place from the moment the admin
    // bundle loads, not from the moment a route of ours is visited.
    installLoginGate();

    app.addSettingsLink(
      {
        id: pluginId,
        intlLabel: { id: `${pluginId}.section.title`, defaultMessage: 'Two-factor authentication' },
      },
      [
        {
          id: `${pluginId}.me`,
          to: `${pluginId}/me`,
          intlLabel: { id: `${pluginId}.link.me`, defaultMessage: 'My authenticator' },
          // Everyone protects their own account, whatever their role.
          permissions: [],
          Component: () => import('./pages/MyAuthenticator').then((mod) => ({ default: mod.default })),
        },
        {
          id: `${pluginId}.policy`,
          to: `${pluginId}/policy`,
          intlLabel: { id: `${pluginId}.link.policy`, defaultMessage: 'Policy' },
          permissions: [{ action: 'plugin::two-factor.settings.read', subject: null }],
          Component: () => import('./pages/Policy').then((mod) => ({ default: mod.default })),
        },
        {
          id: `${pluginId}.users`,
          to: `${pluginId}/users`,
          intlLabel: { id: `${pluginId}.link.users`, defaultMessage: 'Website accounts' },
          permissions: permissions.usersRead,
          Component: () => import('./pages/Users').then((mod) => ({ default: mod.default })),
        },
      ]
    );

    app.registerPlugin({
      id: pluginId,
      name: pluginId,
      icon: Lock,
    });
  },

  bootstrap(app) {
    // After every plugin has registered, so the Content Manager's APIs exist.
    // Checked rather than assumed: a Strapi without the side-panel API simply
    // does not get the panel, and the Website accounts page still works.
    const contentManager = app.getPlugin('content-manager')?.apis;
    if (contentManager && typeof contentManager.addEditViewSidePanel === 'function') {
      contentManager.addEditViewSidePanel([UserTwoFactorPanel]);
    }
  },

  async registerTrads({ locales }) {
    return locales.map((locale) => ({ data: {}, locale }));
  },
};
