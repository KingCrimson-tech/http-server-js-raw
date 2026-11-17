# Benchmark Results

## System

```
Date: 2026-11-17T07:01:32.392Z
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
| from-scratch | `/json` | 10 | 36,187 | 1.13 | 1.00 | 5.00 | 6 | 0 | 0 |
| node:http | `/json` | 10 | 29,912 | 0.01 | 0.00 | 0.00 | 1 | 0 | 0 |
| from-scratch | `/json` | 50 | 33,445 | 1.69 | 2.00 | 5.00 | 42 | 0 | 0 |
| node:http | `/json` | 50 | 30,675 | 1.05 | 1.00 | 3.00 | 4 | 0 | 0 |
| from-scratch | `/json` | 100 | 36,443 | 2.41 | 2.00 | 5.00 | 111 | 0 | 0 |
| node:http | `/json` | 100 | 30,595 | 3.02 | 3.00 | 3.00 | 10 | 0 | 0 |
| from-scratch | `/json` | 200 | 35,792 | 5.14 | 5.00 | 6.00 | 383 | 0 | 0 |
| node:http | `/json` | 200 | 30,237 | 6.14 | 6.00 | 7.00 | 17 | 0 | 0 |
| from-scratch | `/static/index.html` | 10 | 12,879 | 1.34 | 1.00 | 3.00 | 5 | 0 | 0 |
| node:http | `/static/index.html` | 10 | 33,915 | 0.01 | 0.00 | 0.00 | 1 | 0 | 0 |
| from-scratch | `/static/index.html` | 50 | 14,924 | 2.68 | 2.00 | 6.00 | 14 | 0 | 0 |
| node:http | `/static/index.html` | 50 | 33,864 | 1.03 | 1.00 | 2.00 | 5 | 0 | 0 |
| from-scratch | `/static/index.html` | 100 | 15,039 | 6.07 | 5.00 | 10.00 | 78 | 0 | 0 |
| node:http | `/static/index.html` | 100 | 34,459 | 2.13 | 2.00 | 4.00 | 9 | 0 | 0 |
| from-scratch | `/static/index.html` | 200 | 13,585 | 14.20 | 13.00 | 20.00 | 399 | 0 | 0 |
| node:http | `/static/index.html` | 200 | 32,389 | 5.62 | 6.00 | 8.00 | 17 | 0 | 0 |

## Notes

- Both servers are single-process by default for a fair comparison.
- Routes: `/json` (no disk I/O) and `/static/index.html` (streamed from disk).
- `req/s` is requests per second; latency values are in milliseconds.
- Error rate is reported as absolute counts of client/network errors and non-2xx responses.
