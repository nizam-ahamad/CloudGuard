// server/scripts/auditSystemResources.js
const os = require('os');
const v8 = require('v8');

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

console.log('====================================================');
console.log('             CLOUDGUARD SYSTEM & PROCESS AUDIT       ');
console.log('====================================================\n');

// 1. Operating System Resources
const totalMem = os.totalmem();
const freeMem = os.freemem();
const usedMem = totalMem - freeMem;
const cpus = os.cpus();

console.log('--- [1. HOST SYSTEM METRICS] ---');
console.log(`OS Platform       : ${os.platform()} (${os.arch()})`);
console.log(`CPU Model         : ${cpus[0]?.model || 'Unknown'}`);
console.log(`CPU Cores         : ${cpus.length} Core(s)`);
console.log(`Total System RAM  : ${formatMB(totalMem)}`);
console.log(`Used System RAM   : ${formatMB(usedMem)} (${((usedMem / totalMem) * 100).toFixed(1)}%)`);
console.log(`Free System RAM   : ${formatMB(freeMem)} (${((freeMem / totalMem) * 100).toFixed(1)}%)`);
console.log(`OS Load Average   : ${os.loadavg().map(n => n.toFixed(2)).join(', ')} (1m, 5m, 15m)\n`);

// 2. Node.js V8 Runtime Footprint
const mem = process.memoryUsage();
const heapStats = v8.getHeapStatistics();

console.log('--- [2. NODE.JS RUNTIME FOOTPRINT] ---');
console.log(`Process ID (PID)  : ${process.pid}`);
console.log(`Node.js Version   : ${process.version}`);
console.log(`Resident Set (RSS): ${formatMB(mem.rss)} (Physical memory allocated to Node)`);
console.log(`Heap Total        : ${formatMB(mem.heapTotal)}`);
console.log(`Heap Used         : ${formatMB(mem.heapUsed)}`);
console.log(`External Memory   : ${formatMB(mem.external)} (C++ buffers, Sharp/FFmpeg bindings)`);
console.log(`ArrayBuffers      : ${formatMB(mem.arrayBuffers || 0)}`);
console.log(`Heap Limit        : ${formatMB(heapStats.heap_size_limit)}\n`);

// 3. Process Execution
console.log('====================================================');

