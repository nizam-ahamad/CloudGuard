// server/scripts/loadTest.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const autocannon = require('autocannon');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const File = require('../models/File');

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
      const rateLimited4xx = result['4xx'] || 0;
      const serverErrors5xx = result['5xx'] || 0;
      const rps = (result.requests && typeof result.requests.average === 'number') ? result.requests.average : 0;
      const avgLatency = (result.latency && typeof result.latency.average === 'number') ? result.latency.average : 0;
      const p95Latency = (result.latency && (result.latency.p95 || result.latency.p97_5 || result.latency.average)) || 0;
      const p99Latency = (result.latency && (result.latency.p99 || result.latency.average)) || 0;
      const throughputMB = (result.throughput && typeof result.throughput.average === 'number') ? (result.throughput.average / 1024 / 1024).toFixed(2) : '0.00';
      const successRate = totalRequests > 0 ? ((success2xx / totalRequests) * 100).toFixed(1) + '%' : '0.0%';

      console.log(`\n--- ${name} Results ---`);
      console.log(`* Total Requests Completed: ${totalRequests}`);
      console.log(`* 2xx Successes          : ${success2xx}`);
      console.log(`* 4xx Rejections (429/400): ${rateLimited4xx}`);
      console.log(`* 5xx Server Errors      : ${serverErrors5xx}`);
      console.log(`* Req / Second (Average) : ${rps}`);
      console.log(`* Latency (Average)      : ${typeof avgLatency === 'number' ? avgLatency.toFixed(1) : avgLatency} ms`);
      console.log(`* Latency (p95/p97.5)    : ${typeof p95Latency === 'number' ? p95Latency.toFixed(1) : p95Latency} ms`);
      console.log(`* Latency (p99)          : ${typeof p99Latency === 'number' ? p99Latency.toFixed(1) : p99Latency} ms`);
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
        rateLimited4xx,
        serverErrors5xx,
      });

      resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: true });
  });
}

async function runAllLoadTests() {
  try {
    // Scenario 1: Authenticated Read Throughput (Concurrency & DB Connection Pool)
    // Uses distinct client IPs via setupClient so connections simulate distributed users
    let clientCounter = 0;
    await runScenario('1. Vault Read Throughput (GET /api/files)', {
      url: `${BASE_URL}/api/files`,
      connections: 20,
      duration: 15,
      headers: {
        Authorization: `Bearer ${testToken}`,
      },
      setupClient: (client) => {
        clientCounter++;
        client.setHeaders({
          Authorization: `Bearer ${testToken}`,
          'X-Forwarded-For': `10.200.1.${clientCounter % 250}`,
        });
      },
    });

    // Scenario 2: Global Rate Limiter & Proxy Saturation (429 Enforcement)
    // Floods all 50 connections under a single client IP to saturate the 300 req/15m limit
    await runScenario('2. Rate-Limiting Burst Saturation (GET /api/folders)', {
      url: `${BASE_URL}/api/folders`,
      connections: 50,
      duration: 10,
      headers: {
        Authorization: `Bearer ${testToken}`,
        'X-Forwarded-For': '198.51.100.42',
      },
    });

    // Scenario 3: Presigned URL Generation Pipeline (S3 SDK HMAC & DB Throughput)
    let presignClientCounter = 0;
    await runScenario('3. Presigned URL Pipeline (POST /api/files/presigned-url)', {
      url: `${BASE_URL}/api/files/presigned-url`,
      method: 'POST',
      connections: 10,
      duration: 10,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({
        fileName: 'loadtest_temp_file.bin',
        fileSize: 1024,
        mimeType: 'application/octet-stream',
      }),
      setupClient: (client) => {
        presignClientCounter++;
        client.setHeaders({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`,
          'X-Forwarded-For': `10.201.2.${presignClientCounter % 250}`,
        });
      },
    });

    // Scenario 4: AI Microservice Direct Stress Test (:8000)
    await runScenario('4. AI Microservice Scan Throughput (POST /scan)', {
      url: `${AI_URL}/scan`,
      method: 'POST',
      connections: 15,
      duration: 10,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'benchmark_file.exe',
        sha256: 'df765a8ae84a673ae9e8c8e60eca8e7e839351029c58803a107b8f010ce7b736',
      }),
    });

    // Post-Test Non-Destructive Cleanup: Purge any temporary benchmark entries
    if (process.env.MONGO_URI) {
      try {
        console.log('\n[Cleanup] Connecting to database to purge temporary benchmark records...');
        await mongoose.connect(process.env.MONGO_URI);
        const delRes = await File.deleteMany({ name: 'loadtest_temp_file.bin' });
        console.log(`[Cleanup] Successfully purged ${delRes.deletedCount} temporary load-test file records.`);
        await mongoose.disconnect();
      } catch (cleanErr) {
        console.warn('[Cleanup Notice]:', cleanErr.message);
      }
    }

    console.log('\n========================================================================================');
    console.log('                          FINAL LOAD TEST BENCHMARK SUMMARY                             ');
    console.log('========================================================================================');
    console.table(summaryResults);

    process.exit(0);
  } catch (err) {
    console.error('Load testing execution error:', err);
    process.exit(1);
  }
}

runAllLoadTests();

