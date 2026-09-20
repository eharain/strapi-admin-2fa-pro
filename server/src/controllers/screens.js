'use strict';

const { errors } = require('@strapi/utils');

const { getService } = require('../utils/plugin');
const { handled } = require('../utils/respond');
const renderAccountPage = require('../screens/page');
const usersLoginGate = require('../gates/users-login');

const { NotFoundError, ValidationError } = errors;

/**
 * The hosted account pages.
 *
 * Two decisions shape everything here.
 *
 * **The sign-in, reset and forgot handlers call users-permissions' own
 * controller.** They do not reimplement any of it. That matters more than it
 * sounds: password reset is not one function, it is a token, a store of email
 * settings, a template, and the email plugin — and a second copy of that would
 * drift, and would drift silently, because nobody tests the password reset they
 * are not using. Calling the real one means these pages send exactly the email
 * the site is already configured to send.
 *
 * Calling the controller rather than its route also means these pages keep
 * working where `/api/auth/*` has been closed off, which is a normal thing for
 * a deployment to do.
 *
 * **The second factor is the same gate the API uses.** Not a similar one. The
 * hosted sign-in is the gate composed in front of the ordinary login, so there
 * is no second implementation to get out of step with the first.
 */
module.exports = ({ strapi }) => {
  const settings = () => getService(strapi, 'settings');
  const totp = () => getService(strapi, 'totp');

  // Built once: it holds no per-request state.
  const gate = usersLoginGate({ strapi });

  const usersPermissions = () => {
    const plugin = strapi.plugin('users-permissions');
    if (!plugin) {
      throw new NotFoundError('These pages need the users-permissions plugin, which is not installed');
    }
    return plugin;
  };

  const upAuth = () => usersPermissions().controller('auth');

  const requireEnabled = async () => {
    const config = await settings().get();
    if (!config.screens.enabled) {
      // Not "forbidden": when the pages are off they are not there at all.
      throw new NotFoundError('Not found');
    }
    return config;
  };

  /** The server root, whatever path the app is mounted under. */
  const baseOf = (ctx) => {
    const path = ctx.request.path.replace(/\/two-factor\/account\/?$/, '');
    return `${ctx.request.origin}${path}`;
  };

  /**
   * Where an application may be handed back to. The page never decides this —
   * an unchecked return address is how a token ends up somewhere it should not.
   */
  const checkRedirect = (config, ctx) => {
    const uri = ctx.query.redirect_uri;
    if (!uri) return null;

    let parsed;
    try {
      parsed = new URL(String(uri));
    } catch {
      throw new ValidationError('redirect_uri is not a URL');
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    const allowed = (config.screens.redirectOrigins ?? []).some(
      (candidate) => candidate.replace(/\/$/, '') === origin
    );

    if (!allowed) {
      strapi.log.warn(`[two-factor] refused a sign-in handover to ${origin}: not in screens.redirectOrigins`);
      throw new ValidationError(
        `${origin} is not allowed to receive a sign-in from here. Add it to the two-factor plugin's allowed origins.`
      );
    }

    const state = ctx.query.state ? String(ctx.query.state) : null;
    return { uri: parsed.toString(), host: parsed.host, state };
  };

  return {
    /** The page itself. */
    page: handled(async (ctx) => {
      const config = await requireEnabled();
      const redirect = checkRedirect(config, ctx);

      ctx.type = 'html';
      // These pages hold a token in the browser; they have no business being
      // framed by somebody else, or cached.
      ctx.set('X-Frame-Options', 'DENY');
      ctx.set('Cache-Control', 'no-store');
      ctx.set('Referrer-Policy', 'no-referrer');

      ctx.body = renderAccountPage({
        base: baseOf(ctx),
        title: config.screens.title || totp().issuer(),
        logoUrl: config.screens.logoUrl,
        allowPasswordReset: config.screens.allowPasswordReset,
        redirect,
      });
    }),

    /**
     * The page's script and styles, as their own files.
     *
     * They carry nothing account-specific — the configuration is on the page —
     * so they cache well, and they are only served while the pages are on.
     */
    script: handled(async (ctx) => {
      await requireEnabled();
      ctx.type = 'application/javascript';
      ctx.set('Cache-Control', 'public, max-age=300');
      ctx.body = renderAccountPage.SCRIPT;
    }),

    styles: handled(async (ctx) => {
      await requireEnabled();
      ctx.type = 'text/css';
      ctx.set('Cache-Control', 'public, max-age=300');
      ctx.body = renderAccountPage.STYLES;
    }),

    /** Sign in, with the same second-factor gate the API uses. */
    login: handled(async (ctx) => {
      await requireEnabled();
      const auth = upAuth();
      ctx.params = { ...(ctx.params ?? {}), provider: 'local' };
      await gate(ctx, () => auth.callback(ctx));
    }),

    forgotPassword: handled(async (ctx) => {
      const config = await requireEnabled();
      if (!config.screens.allowPasswordReset) throw new NotFoundError('Not found');
      await upAuth().forgotPassword(ctx);
    }),

    resetPassword: handled(async (ctx) => {
      const config = await requireEnabled();
      if (!config.screens.allowPasswordReset) throw new NotFoundError('Not found');
      await upAuth().resetPassword(ctx);
    }),
  };
};
