'use strict';

const PLUGIN_ID = 'two-factor';

const uid = (name) => `plugin::${PLUGIN_ID}.${name}`;

const getService = (strapi, name) => strapi.plugin(PLUGIN_ID).service(name);

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

const fromBase64url = (value) => Buffer.from(String(value), 'base64url');

module.exports = { PLUGIN_ID, uid, getService, base64url, fromBase64url };
