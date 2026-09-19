'use strict';

const account = require('./account');

module.exports = {
  challenge: require('./challenge'),
  administration: require('./administration'),

  /** The signed-in admin acting on their own account. */
  'admin-account': ({ strapi }) => account({ strapi, subjectType: 'admin' }),

  /** The signed-in users-permissions user acting on theirs. */
  'user-account': ({ strapi }) => account({ strapi, subjectType: 'user' }),
};
