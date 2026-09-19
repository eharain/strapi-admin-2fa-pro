import { Lock } from '@strapi/icons';

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
      ]
    );

    app.registerPlugin({
      id: pluginId,
      name: pluginId,
      icon: Lock,
    });
  },

  async registerTrads({ locales }) {
    return locales.map((locale) => ({ data: {}, locale }));
  },
};
