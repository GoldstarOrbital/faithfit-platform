/**
 * k6 load test script for wearable-ingest throughput.
 * Run: k6 run qa/load/wearable-ingest-load-test.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const payload = JSON.stringify({
    userId: `load-user-${__VU}`,
    samples: [{ timestamp: new Date().toISOString(), heartRate: 120 + Math.random() * 40, hrv: 50, steps: 10 }],
  });
  const res = http.post(`${__ENV.BASE_URL || 'http://localhost:4004'}/api/wearable-ingest/healthkit`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'status is 200 or 202': (r) => [200, 202].includes(r.status) });
  sleep(1);
}
