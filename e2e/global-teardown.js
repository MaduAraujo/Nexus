const { withServiceRole } = require('../test-support/pg-rls-client.js');
const { cleanupE2EUsers } = require('../test-support/e2e-seed.js');

module.exports = async function globalTeardown() {
    await withServiceRole((db) => cleanupE2EUsers(db));
};
