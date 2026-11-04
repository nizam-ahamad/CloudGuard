/**
 * CloudGuard Photos Tab High-Concurrency & Memory Benchmark
 * 
 * Simulates 100 concurrent requests against GET /api/files/photos
 * Measures:
 *   - P95 latency (Target: < 35ms)
 *   - Node.js backend process heap memory delta (Target: < 60 MB)
 *   - HTTP Status breakdown, ETag & cache metrics
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

// 1. Locate and load server/.env
const possibleEnvPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(process.cwd(), '.env')
];

let envPath = possibleEnvPaths.find(p => fs.existsSync(p));
if (envPath) {
  try {
    const dotenv = require(path.resolve(__dirname, '../node_modules/dotenv'));
    dotenv.config({ path: envPath });
  } catch (e) {
    // Manually parse .env if dotenv module not found in path
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        process.env[key] = val;
      }
    });
  }
}

// 2. Load jsonwebtoken
let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  try {
    jwt = require(path.resolve(__dirname, '../node_modules/jsonwebtoken'));
  } catch (err) {
    console.error('Error loading jsonwebtoken module:', err.message);
    process.exit(1);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'cloudguard-super-secret-key';
const HOST = '127.0.0.1';
const PORT = process.env.PORT || 5000;
const BASE_URL = `http://${HOST}:${PORT}`;
const TEST_USER_ID = '6ac380db42b85925446c995c';
const TEST_USER_EMAIL = 'benten9210@gmail.com';
const TOTAL_REQUESTS = 100;
const CONCURRENCY = 15;

// Generate valid JWT token for test user
const token = jwt.sign(
  { _id: TEST_USER_ID, email: TEST_USER_EMAIL },
  JWT_SECRET,
  { expiresIn: '1h' }
);

// HTTP Agent with Keep-Alive to measure true network & server capability
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 10000
});

// Helper: Query Server Memory Endpoint
function fetchServerMemory() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/api/internal/memory',
        method: 'GET',
        agent
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Helper: Execute Single Photos Request
function requestPhotos(etag) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const headers = {
      Authorization: `Bearer ${token}`
    };
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/api/files/photos',
        method: 'GET',
        headers,
        agent
      },
      (res) => {
        let bytes = 0;
        const timingHeader = res.headers['server-timing'];
        let serverDuration = null;
        if (timingHeader) {
          const match = timingHeader.match(/dur=([\d.]+)/);
          if (match) serverDuration = parseFloat(match[1]);
        }

        res.on('data', chunk => {
          bytes += chunk.length;
        });

        res.on('end', () => {
          const totalDuration = performance.now() - t0;
          resolve({
            statusCode: res.statusCode,
            duration: totalDuration,
            serverDuration,
            bytes,
            etag: res.headers.etag
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function runBenchmark() {
  console.log('\n================================================================');
  console.log('   CloudGuard Photos High-Concurrency & Memory Benchmark');
  console.log('================================================================');
  console.log(`Target Endpoint : ${BASE_URL}/api/files/photos`);
  console.log(`Test Subject    : User ${TEST_USER_ID} (${TEST_USER_EMAIL})`);
  console.log(`Total Requests  : ${TOTAL_REQUESTS}`);
  console.log(`Concurrency     : ${CONCURRENCY} parallel workers`);
  console.log('----------------------------------------------------------------\n');

  // Verify server is reachable
  try {
    const initCheck = await fetchServerMemory();
    if (!initCheck) {
      console.error('ERROR: Could not connect to CloudGuard server on port', PORT);
      process.exit(1);
    }
  } catch (err) {
    console.error('ERROR: Server not reachable at', BASE_URL, ':', err.message);
    process.exit(1);
  }

  // Phase 1: Warmup & Prime Cache
  process.stdout.write('Priming cache & socket pool (5 warmup requests)... ');
  let cachedEtag = null;
  for (let i = 0; i < 5; i++) {
    const res = await requestPhotos();
    if (res.etag) cachedEtag = res.etag;
  }
  console.log('DONE.');

  // Phase 2: Capture Baseline Memory
  const memBefore = await fetchServerMemory();
  const heapBeforeMB = parseFloat(memBefore.heapUsedMB);
  const rssBeforeMB = parseFloat(memBefore.rssMB);

  console.log(`Server Initial Heap Used : ${heapBeforeMB.toFixed(2)} MB`);
  console.log(`Server Initial RSS       : ${rssBeforeMB.toFixed(2)} MB\n`);

  // Phase 3: Execute 100 Concurrent Requests
  console.log(`Launching ${TOTAL_REQUESTS} concurrent requests...`);
  const queue = Array.from({ length: TOTAL_REQUESTS }, (_, idx) => idx);
  const results = [];
  const testStartTime = performance.now();

  async function worker() {
    while (queue.length > 0) {
      const idx = queue.pop();
      try {
        const result = await requestPhotos();
        results.push(result);
      } catch (err) {
        results.push({ statusCode: 500, duration: 0, error: err.message });
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  const totalWallTime = performance.now() - testStartTime;

  // Phase 4: Capture Post-Test Memory
  const memAfter = await fetchServerMemory();
  const heapAfterMB = parseFloat(memAfter.heapUsedMB);
  const rssAfterMB = parseFloat(memAfter.rssMB);
  const heapDeltaMB = heapAfterMB - heapBeforeMB;
  const rssDeltaMB = rssAfterMB - rssBeforeMB;

  // Phase 5: Compute Latency & Statistics
  const durations = results.map(r => r.duration).sort((a, b) => a - b);
  const serverDurations = results
    .map(r => r.serverDuration)
    .filter(d => d !== null)
    .sort((a, b) => a - b);

  const min = durations[0];
  const max = durations[durations.length - 1];
  const mean = durations.reduce((acc, d) => acc + d, 0) / durations.length;
  const p50 = durations[Math.floor(durations.length * 0.50)];
  const p90 = durations[Math.floor(durations.length * 0.90)];
  const p95 = durations[Math.floor(durations.length * 0.95)];
  const p99 = durations[Math.floor(durations.length * 0.99)];

  const statusCounts = {};
  results.forEach(r => {
    statusCounts[r.statusCode] = (statusCounts[r.statusCode] || 0) + 1;
  });

  const throughput = (TOTAL_REQUESTS / (totalWallTime / 1000)).toFixed(1);

  // Targets evaluation
  const p95Target = 35.0; // ms
  const heapDeltaTarget = 60.0; // MB

  const p95Passed = p95 <= p95Target;
  const heapPassed = Math.abs(heapDeltaMB) <= heapDeltaTarget;

  console.log('\n================================================================');
  console.log('                      BENCHMARK RESULTS                         ');
  console.log('================================================================');
  console.log(`Total Requests      : ${TOTAL_REQUESTS}`);
  console.log(`Successful (200 OK) : ${statusCounts[200] || 0}`);
  console.log(`Wall Clock Time     : ${totalWallTime.toFixed(2)} ms`);
  console.log(`Throughput          : ${throughput} req/sec`);
  console.log('----------------------------------------------------------------');
  console.log('LATENCY DISTRIBUTION (End-to-End Client Latency):');
  console.log(`  Min               : ${min.toFixed(2)} ms`);
  console.log(`  Mean (Average)    : ${mean.toFixed(2)} ms`);
  console.log(`  P50 (Median)      : ${p50.toFixed(2)} ms`);
  console.log(`  P90               : ${p90.toFixed(2)} ms`);
  console.log(`  P95 (Target <35ms): ${p95.toFixed(2)} ms   --> [${p95Passed ? 'PASS' : 'FAIL'}]`);
  console.log(`  P99               : ${p99.toFixed(2)} ms`);
  console.log(`  Max               : ${max.toFixed(2)} ms`);

  if (serverDurations.length > 0) {
    const sP50 = serverDurations[Math.floor(serverDurations.length * 0.50)];
    const sP95 = serverDurations[Math.floor(serverDurations.length * 0.95)];
    console.log('----------------------------------------------------------------');
    console.log('SERVER INTERNAL LATENCY (Server-Timing Header):');
    console.log(`  Server P50        : ${sP50.toFixed(2)} ms`);
    console.log(`  Server P95        : ${sP95.toFixed(2)} ms`);
  }

  console.log('----------------------------------------------------------------');
  console.log('NODE.JS PROCESS HEAP MEMORY:');
  console.log(`  Initial Heap Used : ${heapBeforeMB.toFixed(2)} MB`);
  console.log(`  Final Heap Used   : ${heapAfterMB.toFixed(2)} MB`);
  console.log(`  Heap Delta (Used) : ${heapDeltaMB >= 0 ? '+' : ''}${heapDeltaMB.toFixed(2)} MB  (Target: < 60 MB) --> [${heapPassed ? 'PASS' : 'FAIL'}]`);
  console.log(`  Initial RSS       : ${rssBeforeMB.toFixed(2)} MB`);
  console.log(`  Final RSS         : ${rssAfterMB.toFixed(2)} MB`);
  console.log(`  RSS Delta         : ${rssDeltaMB >= 0 ? '+' : ''}${rssDeltaMB.toFixed(2)} MB`);
  console.log('================================================================');

  if (p95Passed && heapPassed) {
    console.log('   ALL AUDIT TARGETS PASSED SUCCESSFULLY!');
  } else {
    console.log('   ONE OR MORE AUDIT TARGETS FAILED.');
  }
  console.log('================================================================\n');

  agent.destroy();
  process.exit(p95Passed && heapPassed ? 0 : 1);
}

runBenchmark().catch(err => {
  console.error('Unhandled benchmark error:', err);
  process.exit(1);
});

