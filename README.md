---
# Valkeyrie - KeyValue DB

<p align="center">
 <img align="center" alt="Valkeyrie" height="200" src="https://github.com/user-attachments/assets/87c60a17-0f17-42aa-9db8-993dddb08e31">
</p>

---

[![GitHub package.json version](https://img.shields.io/github/package-json/v/ducktors/valkeyrie)](https://github.com/ducktors/valkeyrie/releases) ![node:22.14.0](https://img.shields.io/badge/node-22.14.0-lightgreen) ![pnpm@10.6.2](https://img.shields.io/badge/pnpm-10.6.2-yellow) [![npm](https://img.shields.io/npm/dt/valkeyrie)](https://www.npmjs.com/package/valkeyrie) [![CI](https://github.com/ducktors/valkeyrie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ducktors/valkeyrie/actions/workflows/ci.yml) [![Test](https://github.com/ducktors/valkeyrie/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/ducktors/valkeyrie/actions/workflows/test.yaml) [![Coverage Status](https://coveralls.io/repos/github/ducktors/valkeyrie/badge.svg)](https://coveralls.io/github/ducktors/valkeyrie) [![Maintainability](https://api.codeclimate.com/v1/badges/c1a77d6d8b158d442572/maintainability)](https://codeclimate.com/github/ducktors/valkeyrie/maintainability) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ducktors/valkeyrie/badge)](https://scorecard.dev/viewer/?uri=github.com/ducktors/valkeyrie)


`Valkeyrie` is a Node.js key-value store.

## Benchmarks

Valkeyrie includes a comprehensive benchmarking suite to measure performance and track regressions over time. The benchmarks test various operations including:

- Basic operations (get, set, delete)
- List operations
- Atomic operations

### Running Benchmarks

You can run the benchmarks using the following commands:

```bash
# Run all benchmarks
pnpm benchmark

# Run specific benchmark suites
pnpm benchmark:basic    # Basic operations
pnpm benchmark:list     # List operations
pnpm benchmark:atomic   # Atomic operations
```

### Benchmark Results

Benchmark results are automatically tracked in CI for pull requests, allowing us to identify performance regressions before they're merged into the main branch.

For more details on the benchmarking methodology and how to add new benchmarks, see the [benchmark README](./benchmark/README.md).
