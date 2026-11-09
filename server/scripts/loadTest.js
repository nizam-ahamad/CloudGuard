// server/scripts/loadTest.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const autocannon = require('autocannon');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const API_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${API_PORT}`;
const AI_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Generate valid test JWT token
const testToken = jwt.sign(
  { id: '6ac380db42b85925446c995c', _id: '6ac380db42b85925446c995c', email: 'loadtest@cloudguard.site' },
  JWT_SECRET,
  { expiresIn: '1h', algorithm: 'HS256' }
);

const summaryResults = [];

async function runScenario(name, config) {
  console.log(`\n======================================================`);
  console.log(` Starting Scenario: ${name}`);
  console.log(` Target: ${config.url} | Concurrency: ${config.connections} | Duration: ${config.duration}s`);
  console.log(`======================================================`);

  return new Promise((resolve, reject) => {
    const instance = autocannon(config, (err, result) => {
      if (err) return reject(err);

      const totalRequests = (result['2xx'] || 0) + (result['4xx'] || 0) + (result['5xx'] || 0);
      const success2xx = result['2xx'] || 0;
      const rejections4xx = result['4xx'] || 0;
      const serverErrors5xx = result['5xx'] || 0;
      const rps = (result.requests?.average || result.requests?.mean || 0);
      const avgLatency = (result.latency?.average || result.latency?.mean || 0);
      const p95Latency = (result.latency?.p95 || result.latency?.p97_5 || 0);
      const p99Latency = (result.latency?.p99 || 0);
      const throughputMB = ((result.throughput?.average || 0) / 1024 / 1024).toFixed(2);
      const successRate = totalRequests > 0 ? ((success2xx / totalRequests) * 100).toFixed(1) + '%' : '0.0%';

      console.log(`\n--- ${name} Results ---`);
      console.log(`* Total Requests Completed: ${totalRequests}`);
      console.log(`* 2xx Successes          : ${success2xx}`);
      console.log(`* 4xx Rejections         : ${rejections4xx}`);
      console.log(`* 5xx Server Errors      : ${serverErrors5xx}`);
      console.log(`* Req / Second (Average) : ${typeof rps === 'number' ? rps.toFixed(2) : rps}`);
      console.log(`* Latency (Average)      : ${typeof avgLatency === 'number' ? avgLatency.toFixed(2) : avgLatency} ms`);
      console.log(`* Latency (p95/p97.5)    : ${typeof p95Latency === 'number' ? p95Latency.toFixed(2) : p95Latency} ms`);
      console.log(`* Latency (p99)          : ${typeof p99Latency === 'number' ? p99Latency.toFixed(2) : p99Latency} ms`);
      console.log(`* Throughput (Bytes/sec) : ${throughputMB} MB/s`);

      summaryResults.push({
        name,
        connections: config.connections,
        duration: `${config.duration}s`,
        rps: Math.round(rps),
        avgLatency: `${typeof avgLatency === 'number' ? avgLatency.toFixed(1) : avgLatency} ms`,
        p95Latency: `${typeof p95Latency === 'number' ? p95Latency.toFixed(1) : p95Latency} ms`,
        p99Latency: `${typeof p99Latency === 'number' ? p99Latency.toFixed(1) : p99Latency} ms`,
        successRate,
        success2xx,
        rejections4xx,
        serverErrors5xx,
      });

      resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function cleanupBenchmarkArtifacts() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) return;

    await mongoose.connect(mongoUri);
    const File = mongoose.models.File || require('../models/File');
    const deleteResult = await File.deleteMany({
      name: { $regex: /^benchmark_/i },
    });
    console.log(`[Cleanup] Purged ${deleteResult.deletedCount} temporary benchmark records from MongoDB.`);
    await mongoose.disconnect();
  } catch (err) {
    console.warn('[Cleanup Notice]:', err.message);
  }
}

async function runAllLoadTests() {
  try {
    // 1. Vault Read Throughput at Scale (50 concurrent connections)
    let clientCounter1 = 0;
    await runScenario('1. Vault Read Throughput (50 Concurrency)', {
      url: `${BASE_URL}/api/files`,
      connections: 50,
      duration: 15,
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
      setupClient: (client) => {
        clientCounter1++;
        client.setHeaders({
          Authorization: `Bearer ${testToken}`,
          'X-Forwarded-For': `10.150.1.${clientCounter1 % 250}`,
        });
      },
    });

    // 2. Maximum Pool Saturation Test (100 concurrent connections)
    let clientCounter2 = 0;
    await runScenario('2. Pool Saturation Test (100 Concurrency)', {
      url: `${BASE_URL}/api/files`,
      connections: 100,
      duration: 15,
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
      setupClient: (client) => {
        clientCounter2++;
        client.setHeaders({
          Authorization: `Bearer ${testToken}`,
          'X-Forwarded-For': `10.150.2.${clientCounter2 % 250}`,
        });
      },
    });

    // 3. Presigned URL Generation Pipeline (25 concurrent connections)
    let clientCounter3 = 0;
    await runScenario('3. Presigned URL Pipeline (25 Concurrency)', {
      url: `${BASE_URL}/api/files/presigned-url`,
      method: 'POST',
      connections: 25,
      duration: 10,
      headers: {
        Authorization: `Bearer ${testToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'benchmark_loadtest.dat',
        fileSize: 1048576,
        mimeType: 'application/octet-stream',
      }),
      setupClient: (client) => {
        clientCounter3++;
        client.setHeaders({
          Authorization: `Bearer ${testToken}`,
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.150.3.${clientCounter3 % 250}`,
        });
      },
    });

    // 4. AI Microservice High Concurrency Stress Test (:8000)
    await runScenario('4. AI Microservice Stress Test (30 Concurrency)', {
      url: `${AI_URL}/scan`,
      method: 'POST',
      connections: 30,
      duration: 10,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'benchmark_binary.exe',
        sha256: 'df765a8ae84a673ae9e8c8e60eca8e7e839351029c58803a107b8f010ce7b736',
      }),
    });

    await cleanupBenchmarkArtifacts();

    console.log('\n========================================================================================');
    console.log('              POST-ADJUSTMENT LOAD TEST BENCHMARK SUMMARY (POOL: 100)                   ');
    console.log('========================================================================================');
    console.table(summaryResults);

    console.log('\nAll post-adjustment load testing scenarios completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Load testing execution error:', err);
    await cleanupBenchmarkArtifacts();
    process.exit(1);
  }
}

runAllLoadTests();
