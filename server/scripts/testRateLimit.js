/**
 * Automated Rate Limiting and Proxy Trust Verification Script
 * CloudGuard API Rate Limiter Test Suite
 */

const BASE_URL = 'http://localhost:5000';

async function runRateLimitTests() {
  console.log('='.repeat(65));
  console.log('  CloudGuard Rate-Limiting & Proxy Trust Automated Test Suite');
  console.log('='.repeat(65));
  console.log(`Target URL: ${BASE_URL}\n`);

  const results = {
    headerTest: null,
    otpTest: [],
    globalTest: null,
    proxyTrustTest: null,
  };

  // -------------------------------------------------------------
  // Test 1: Rate-Limit Header Presence & Format
  // -------------------------------------------------------------
  console.log('--- Test 1: Standard Rate-Limit Header Inspection ---');
  const testIp1 = `203.0.113.${Math.floor(Math.random() * 150) + 50}`;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIp1,
      },
      body: JSON.stringify({ email: 'audit_test@example.com', password: 'MockPassword123!' }),
    });

    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');
    const reset = res.headers.get('ratelimit-reset');
    const policy = res.headers.get('ratelimit-policy');

    results.headerTest = {
      status: res.status,
      limit,
      remaining,
      reset,
      policy,
      hasHeaders: Boolean(limit && remaining && reset),
    };

    console.log(`Response Status : ${res.status}`);
    console.log(`RateLimit-Limit : ${limit}`);
    console.log(`RateLimit-Remaining: ${remaining}`);
    console.log(`RateLimit-Reset : ${reset}s`);
    console.log(`RateLimit-Policy: ${policy}`);
    console.log(`Header Validation: ${results.headerTest.hasHeaders ? 'PASS [Headers Present]' : 'FAIL [Missing Headers]'}\n`);
  } catch (err) {
    console.error('Test 1 Failed to connect:', err.message);
  }

  // -------------------------------------------------------------
  // Test 2: OTP Limiter Threshold (Max 5 requests -> 6th throttled)
  // -------------------------------------------------------------
  console.log('--- Test 2: OTP Limiter Threshold & 429 Enforcement (Max 5) ---');
  const testIpOtp = `198.51.100.${Math.floor(Math.random() * 150) + 50}`;
  console.log(`Simulated Client IP: ${testIpOtp}`);

  for (let i = 1; i <= 6; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': testIpOtp,
        },
        body: JSON.stringify({ email: 'otp_audit@example.com', otp: '123456' }),
      });

      const body = await res.json().catch(() => ({}));
      const item = {
        attempt: i,
        status: res.status,
        limit: res.headers.get('ratelimit-limit'),
        remaining: res.headers.get('ratelimit-remaining'),
        message: body.error || body.message || 'OK',
      };
      results.otpTest.push(item);

      console.log(
        `Request #${i}: HTTP ${res.status} | Limit=${item.limit} | Remaining=${item.remaining} | Msg="${item.message}"`
      );
    } catch (err) {
      console.error(`Request #${i} Failed:`, err.message);
    }
  }

  const req6 = results.otpTest[5];
  const otpPass = req6 && req6.status === 429;
  console.log(`OTP 429 Enforcement: ${otpPass ? 'PASS [Request #6 blocked with HTTP 429]' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // Test 3: Global Baseline Limiter Availability (Max 300)
  // -------------------------------------------------------------
  console.log('--- Test 3: Global Baseline API Limiter (300 requests/15m) ---');
  const testIpGlobal = `192.0.2.${Math.floor(Math.random() * 150) + 50}`;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIpGlobal,
      },
      body: JSON.stringify({}),
    });

    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');

    results.globalTest = {
      status: res.status,
      limit,
      remaining,
      pass: res.status !== 429,
    };

    console.log(`Baseline Route  : /api/auth/google`);
    console.log(`Response Status : ${res.status} (Non-throttled passthrough)`);
    console.log(`Global Limit    : ${limit}`);
    console.log(`Global Remaining: ${remaining}`);
    console.log(`Baseline Check  : ${results.globalTest.pass ? 'PASS' : 'FAIL'}\n`);
  } catch (err) {
    console.error('Test 3 Failed:', err.message);
  }

  // -------------------------------------------------------------
  // Test 4: Proxy Trust Verification (Per-IP Isolation Check)
  // -------------------------------------------------------------
  console.log('--- Test 4: Reverse Proxy Trust Verification (Client IP Isolation) ---');
  const freshIp = `198.51.100.${Math.floor(Math.random() * 150) + 200}`;
  try {
    // Check throttled IP (should remain 429)
    const throttledRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIpOtp,
      },
      body: JSON.stringify({ email: 'otp_audit@example.com', otp: '123456' }),
    });

    // Check fresh IP (should NOT be throttled, remaining should be 4)
    const freshRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': freshIp,
      },
      body: JSON.stringify({ email: 'otp_audit@example.com', otp: '123456' }),
    });

    const isIsolated = throttledRes.status === 429 && freshRes.status !== 429;
    results.proxyTrustTest = {
      throttledIpStatus: throttledRes.status,
      freshIpStatus: freshRes.status,
      freshRemaining: freshRes.headers.get('ratelimit-remaining'),
      pass: isIsolated,
    };

    console.log(`Throttled IP (${testIpOtp}) -> HTTP ${throttledRes.status} (Blocked)`);
    console.log(`Fresh IP     (${freshIp}) -> HTTP ${freshRes.status} (Remaining: ${results.proxyTrustTest.freshRemaining})`);
    console.log(`Proxy Trust Check: ${isIsolated ? 'PASS [Real Client IP Isolated via X-Forwarded-For]' : 'FAIL'}\n`);
  } catch (err) {
    console.error('Test 4 Failed:', err.message);
  }

  // -------------------------------------------------------------
  // Summary Table Output
  // -------------------------------------------------------------
  console.log('='.repeat(65));
  console.log('                       FINAL RESULTS SUMMARY');
  console.log('='.repeat(65));
  console.table([
    {
      'Test Scenario': 'Auth Header Presence',
      'Target Route': '/api/auth/login',
      'Configured Limit': '10 req / 15 min',
      'Observed Behavior': `Headers Present (${results.headerTest?.limit} limit)`,
      'Status': results.headerTest?.hasHeaders ? 'PASS' : 'FAIL',
    },
    {
      'Test Scenario': 'OTP Limiter (Requests 1-5)',
      'Target Route': '/api/auth/verify-otp',
      'Configured Limit': '5 req / 15 min',
      'Observed Behavior': `HTTP ${results.otpTest[0]?.status} (Allowed)`,
      'Status': results.otpTest.slice(0, 5).every(r => r.status !== 429) ? 'PASS' : 'FAIL',
    },
    {
      'Test Scenario': 'OTP Limiter (Request 6)',
      'Target Route': '/api/auth/verify-otp',
      'Configured Limit': '5 req / 15 min',
      'Observed Behavior': `HTTP ${results.otpTest[5]?.status} (Throttled 429)`,
      'Status': results.otpTest[5]?.status === 429 ? 'PASS' : 'FAIL',
    },
    {
      'Test Scenario': 'Global API Limiter',
      'Target Route': '/api/*',
      'Configured Limit': '300 req / 15 min',
      'Observed Behavior': `HTTP ${results.globalTest?.status} (Limit ${results.globalTest?.limit})`,
      'Status': results.globalTest?.pass ? 'PASS' : 'FAIL',
    },
    {
      'Test Scenario': 'Proxy Trust (IP Isolation)',
      'Target Route': 'X-Forwarded-For Trust',
      'Configured Limit': 'Single Hop (1)',
      'Observed Behavior': `Throttled IP=429, Fresh IP=${results.proxyTrustTest?.freshIpStatus}`,
      'Status': results.proxyTrustTest?.pass ? 'PASS' : 'FAIL',
    },
  ]);
  console.log('='.repeat(65));
}

runRateLimitTests();

