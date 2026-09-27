const { withServiceRole } = require('../test-support/pg-rls-client.js');
const { cleanupE2EUsers } = require('../test-support/e2e-seed.js');
const { resetE2EData } = require('./support.js');

module.exports = async function globalTeardown() {
    await resetE2EData();
    await withServiceRole((db) => cleanupE2EUsers(db));
};
