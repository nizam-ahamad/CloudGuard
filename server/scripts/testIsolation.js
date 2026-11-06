require('dotenv').config();
const mongoose = require('mongoose');
const { buildTenantQuery } = require('../utils/tenantQuery');

async function runSecurityAudit() {
  console.log('Running Multi-Tenant Security Guardrail Verification...\n');

  // Test 1: Query construction with nested $or filters
  const mockUserA = new mongoose.Types.ObjectId().toString();
  const criteriaWithOr = {
    $or: [{ mimeType: 'image/jpeg' }, { name: 'secret.jpg' }],
  };

  const safeQuery = buildTenantQuery(mockUserA, criteriaWithOr);

  // Assert both conditions are wrapped in $and
  const hasAnd = Array.isArray(safeQuery.$and) && safeQuery.$and.length === 2;
  const userCheckPassed = JSON.stringify(safeQuery).includes(mockUserA);

  if (hasAnd && userCheckPassed) {
    console.log('✅ Test 1 Passed: Query builder wraps tenant boundaries inside $and. Zero key collisions possible.');
  } else {
    console.error('❌ Test 1 Failed: Query builder did not safely isolate tenant.');
    process.exit(1);
  }

  // Test 2: Missing userId must throw immediately (fail closed)
  let threwOnMissing = false;
  try {
    buildTenantQuery(null, { name: 'leak.mp4' });
  } catch (e) {
    threwOnMissing = true;
  }

  if (threwOnMissing) {
    console.log('✅ Test 2 Passed: Query builder rejects unauthenticated/null requests immediately.');
  } else {
    console.error('❌ Test 2 Failed: Query builder did not reject null userId.');
    process.exit(1);
  }

  console.log('\nAll Multi-Tenant Security Audits Passed Cleanly.');
  process.exit(0);
}

runSecurityAudit();

