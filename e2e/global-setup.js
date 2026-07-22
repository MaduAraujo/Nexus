const { withServiceRole } = require('../test-support/pg-rls-client.js');
const { seedE2EUsers } = require('../test-support/e2e-seed.js');

module.exports = async function globalSetup() {
    await withServiceRole((db) => seedE2EUsers(db));
};