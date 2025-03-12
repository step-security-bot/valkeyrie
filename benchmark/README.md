# Valkeyrie Benchmarks

This directory contains benchmarks for the Valkeyrie key-value store. These benchmarks are designed to measure the performance of various operations and track performance regressions over time.

## Running Benchmarks

You can run all benchmarks or specific benchmark suites using the following npm scripts:

```bash
# Run all benchmarks
pnpm benchmark

# Run specific benchmark suites
pnpm benchmark:basic    # Basic operations (get, set, delete)
pnpm benchmark:list     # List operations
pnpm benchmark:atomic   # Atomic operations
```

## Benchmark Suites

### Basic Operations (`basic.ts`)

Tests the performance of fundamental operations:
- `set` with different value sizes (small, medium, large)
- `get` with different value sizes
- `delete` operations
- `KvU64` operations

### List Operations (`list.ts`)

Tests the performance of list operations:
- Listing with different collection sizes (small, medium, large)
- Listing with limits
- Listing in reverse order
- Using `Array.fromAsync` with lists

### Atomic Operations (`atomic.ts`)

Tests the performance of atomic operations:
- Single atomic operations
- Multiple atomic operations
- Check and set operations
- Atomic delete operations
- Numeric operations (sum, max, min)
- Complex mixed atomic operations

## Benchmark Design

The benchmarks are designed to measure the actual performance of operations without including database initialization overhead:

1. Database connection is opened once before running the benchmarks
2. Test data is prepared outside the benchmark functions
3. Only the specific operation being measured is included in the benchmark function
4. Database connection is closed after all benchmarks have run

This approach provides more accurate measurements of the actual operations being tested.

## Tracking Performance Over Time

To track performance over time, you can:

1. Run benchmarks before and after significant changes
2. Save benchmark results to a file:
   ```bash
   pnpm benchmark > benchmark-results-$(date +%Y%m%d).txt
   ```
3. Compare results to identify performance regressions

## Adding New Benchmarks

To add a new benchmark:

1. Create a new benchmark file in the `benchmark` directory
2. Import and use the `bench` and `run` functions from `mitata`
3. Add the benchmark to `index.ts`
4. Add a new script to `package.json` if needed 