'use strict';

const { errors } = require('@strapi/utils');

const { ApplicationError, ForbiddenError, NotFoundError, UnauthorizedError } = errors;

const STATUSES = [
  [UnauthorizedError, 401],
  [ForbiddenError, 403],
  [NotFoundError, 404],
];

/**
 * Write the refusal instead of throwing it.
 *
 * Strapi composes a route as `[authenticate, authorize, …middlewares, action]`,
 * and `authorize` awaits everything downstream inside the try/catch it uses for
 * its own check. An `UnauthorizedError` raised by a controller is caught there
 * and answered with a bare `ctx.unauthorized()` — the status survives, the
 * message does not.
 *
 * That matters here more than it would in most plugins. "That code has already
 * been used, wait for the next one" and "too many wrong codes, try again in
 * twelve minutes" are the difference between someone getting back in and
 * someone filing a ticket, and both would arrive as the word "Unauthorized".
 *
 * So the services still throw typed errors — that is the right shape for
 * anything calling them directly — and the controllers turn them into a
 * response on the way out.
 *
 * `insideSession` is for routes behind an admin session, and it answers a
 * refused code with 403 rather than 401. The admin panel's fetch client reads
 * the status from the response *body*, treats any 401 as an expired session,
 * refreshes it and **sends the request again** — so a mistyped code was
 * submitted twice and counted twice towards the lockout, and three typos were
 * enough to lock somebody out of their own account. Inside a valid session a
 * wrong code is not a session problem; 403 says "understood, and no" without
 * setting that off. The users-permissions surface keeps 401, which is what the
 * services that call it already read.
 */
const handled = (work, { insideSession = false } = {}) => async (ctx) => {
  try {
    await work(ctx);
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;

    const match = STATUSES.find(([type]) => error instanceof type);
    let status = match ? match[1] : 400;
    if (insideSession && status === 401) status = 403;

    ctx.status = status;
    ctx.body = {
      data: null,
      error: {
        status,
        name: error.name,
        message: error.message,
        details: error.details ?? {},
      },
    };
  }
};

module.exports = { handled };
