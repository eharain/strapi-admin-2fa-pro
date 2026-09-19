'use strict';

const factor = require('./factor/schema.json');
const recoveryCode = require('./recovery-code/schema.json');

module.exports = {
  factor: { schema: factor },
  'recovery-code': { schema: recoveryCode },
};
