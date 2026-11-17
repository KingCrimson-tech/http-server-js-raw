/** Lightweight in-process metrics: counters + latency histogram. */

const LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this._resetCounters();
  }

  _resetCounters() {
    this.requests = 0;
    this.responses = 0;
    this.bytes = 0;
    this.errors = 0;
    this.byStatus = Object.create(null);
    this.byMethod = Object.create(null);
    this.latencyBuckets = new Array(LATENCY_BUCKETS_MS.length).fill(0);
    this.latencySum = 0;
    this.latencyMax = 0;
  }

  reset() {
    this._resetCounters();
  }

  record({ method = 'GET', status = 200, durationMs = 0, bytes = 0 } = {}) {
    this.requests += 1;
    this.responses += 1;
    this.bytes += bytes;
    this.byStatus[status] = (this.byStatus[status] || 0) + 1;
    this.byMethod[method] = (this.byMethod[method] || 0) + 1;
    if (status >= 400) this.errors += 1;

    this.latencySum += durationMs;
    if (durationMs > this.latencyMax) this.latencyMax = durationMs;
    const index = LATENCY_BUCKETS_MS.findIndex((ms) => durationMs <= ms);
    // Increment every bucket at or above the observed value (standard histogram).
    // Values above the largest bound only land in the synthetic +Inf bucket.
    for (let i = index === -1 ? LATENCY_BUCKETS_MS.length : index; i < LATENCY_BUCKETS_MS.length; i++) {
      this.latencyBuckets[i] += 1;
    }
  }

  snapshot() {
    return {
      requests: this.requests,
      responses: this.responses,
      bytes: this.bytes,
      errors: this.errors,
      byStatus: { ...this.byStatus },
      byMethod: { ...this.byMethod },
      latencyBuckets: [...this.latencyBuckets],
      latencySum: this.latencySum,
      latencyMax: this.latencyMax,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  /** Prometheus text exposition format. */
  toPrometheus() {
    const s = this.snapshot();
    const lines = [
      '# HELP raw_http_requests_total Total HTTP requests received.',
      '# TYPE raw_http_requests_total counter',
      `raw_http_requests_total ${s.requests}`,
      '# HELP raw_http_responses_total Total HTTP responses sent.',
      '# TYPE raw_http_responses_total counter',
      `raw_http_responses_total ${s.responses}`,
      '# HELP raw_http_bytes_total Total response body bytes written.',
      '# TYPE raw_http_bytes_total counter',
      `raw_http_bytes_total ${s.bytes}`,
      '# HELP raw_http_errors_total Total responses with status >= 400.',
      '# TYPE raw_http_errors_total counter',
      `raw_http_errors_total ${s.errors}`,
      '# HELP raw_http_request_duration_ms Request latency histogram in milliseconds.',
      '# TYPE raw_http_request_duration_ms histogram',
    ];
    LATENCY_BUCKETS_MS.forEach((ms, i) => {
      lines.push(`raw_http_request_duration_ms_bucket{le="${ms}"} ${s.latencyBuckets[i]}`);
    });
    lines.push(`raw_http_request_duration_ms_bucket{le="+Inf"} ${s.requests}`);
    lines.push(`raw_http_request_duration_ms_sum ${s.latencySum.toFixed(3)}`);
    lines.push(`raw_http_request_duration_ms_max ${s.latencyMax.toFixed(3)}`);
    lines.push('# HELP raw_http_responses_by_status Responses by status code.');
    lines.push('# TYPE raw_http_responses_by_status counter');
    for (const [code, count] of Object.entries(s.byStatus)) {
      lines.push(`raw_http_responses_by_status{code="${code}"} ${count}`);
    }
    lines.push('# HELP raw_http_requests_by_method Requests by method.');
    lines.push('# TYPE raw_http_requests_by_method counter');
    for (const [method, count] of Object.entries(s.byMethod)) {
      lines.push(`raw_http_requests_by_method{method="${method}"} ${count}`);
    }
    return lines.join('\n') + '\n';
  }
}

export { LATENCY_BUCKETS_MS };
