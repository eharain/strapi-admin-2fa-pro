'use strict';

const services = require('../server/src/services');

/**
 * A Strapi stand-in with just enough on it to instantiate the services.
 *
 * The services that touch the database are not exercised here — those are the
 * ones the integration checks in `docs/verifying.md` cover against a real
 * instance. What these tests are for is the part that has to be right on its
 * own terms: the crypto, the tokens, and the TOTP behaviour around replay and
 * drift.
 */
const createStrapi = (overrides = {}) => {
  const configValues = {
    'admin.auth.secret': 'a-test-secret-that-is-long-enough-to-be-plausible',
    'plugin::two-factor.digits': 6,
    'plugin::two-factor.period': 30,
    ...(overrides.config || {}),
  };

  const instances = {};

  const strapi = {
    config: {
      get: (key, fallback) => (key in configValues ? configValues[key] : fallback),
    },
    log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    plugin: () => ({ service: (name) => instances[name] }),
    eventHub: { emit: () => {} },
  };

  for (const [name, factory] of Object.entries(services)) {
    instances[name] = factory({ strapi });
  }

  // A test can replace a service with a stub — the gates reach for `policy` and
  // `factors`, and what is under test there is what the gate does with the
  // answer, not how the answer was reached.
  Object.assign(instances, overrides.services || {});

  strapi.services = instances;
  return strapi;
};

module.exports = { createStrapi };
