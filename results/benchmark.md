# Benchmark Results

## System

```
Date: 2026-11-17T07:03:38.222Z
Node: v24.19.0
CPU: AMD Ryzen 5 5600H with Radeon Graphics (12 logical cores)
RAM: 14.9 GiB
OS: linux 7.3.3-200.fc44.x86_64
Duration: 3s/run, 1s warm-up, 1 reps (median)
Raw server workers: 1
```

## Results

| Server | Route | Connections | Req/s (median) | Avg ms | p50 ms | p99 ms | Max ms | Errors | Non-2xx |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| from-scratch | `/json` | 10 | 37,968 | 1.15 | 1.00 | 5.00 | 6 | 0 | 0 |
| node:http | `/json` | 10 | 30,003 | 0.01 | 0.00 | 0.00 | 3 | 0 | 0 |
| from-scratch | `/json` | 50 | 38,299 | 1.79 | 2.00 | 5.00 | 25 | 0 | 0 |
| node:http | `/json` | 50 | 30,936 | 1.05 | 1.00 | 3.00 | 5 | 0 | 0 |
| from-scratch | `/json` | 100 | 38,725 | 2.47 | 2.00 | 5.00 | 106 | 0 | 0 |
| node:http | `/json` | 100 | 30,691 | 3.02 | 3.00 | 5.00 | 10 | 0 | 0 |
| from-scratch | `/json` | 200 | 36,837 | 5.10 | 5.00 | 7.00 | 268 | 0 | 0 |
| node:http | `/json` | 200 | 29,581 | 6.30 | 6.00 | 8.00 | 19 | 0 | 0 |
| from-scratch | `/static/index.html` | 10 | 11,940 | 1.43 | 1.00 | 5.00 | 7 | 0 | 0 |
| node:http | `/static/index.html` | 10 | 15,044 | 0.02 | 0.00 | 1.00 | 3 | 0 | 0 |
| from-scratch | `/static/index.html` | 50 | 13,561 | 3.15 | 3.00 | 6.00 | 17 | 0 | 0 |
| node:http | `/static/index.html` | 50 | 16,716 | 2.49 | 2.00 | 6.00 | 12 | 0 | 0 |
| from-scratch | `/static/index.html` | 100 | 13,420 | 6.95 | 6.00 | 12.00 | 87 | 0 | 0 |
| node:http | `/static/index.html` | 100 | 16,220 | 5.65 | 5.00 | 10.00 | 13 | 0 | 0 |
| from-scratch | `/static/index.html` | 200 | 13,153 | 14.68 | 14.00 | 21.00 | 382 | 0 | 0 |
| node:http | `/static/index.html` | 200 | 16,007 | 11.95 | 11.00 | 22.00 | 26 | 0 | 0 |

## Notes

- Both servers are single-process by default for a fair comparison.
- Routes: `/json` (no disk I/O) and `/static/index.html` (streamed from disk).
- `req/s` is requests per second; latency values are in milliseconds.
- Error rate is reported as absolute counts of client/network errors and non-2xx responses.
