import { bench, run } from 'mitata'
import { KvU64 } from '../src/kv-u64.js'
import { Valkeyrie } from '../src/valkeyrie.js'

// Helper to generate random keys
function generateRandomKey(length = 1): string[] {
  return Array.from({ length }, () =>
    Math.random().toString(36).substring(2, 15),
  )
}

// Helper to generate random values of different sizes
function generateRandomValue(sizeInBytes: number): string {
  return 'x'.repeat(sizeInBytes)
}

// Benchmark for basic operations
async function runBasicBenchmarks() {
  console.log('Running basic operation benchmarks...')

  // Small data size (10 bytes)
  const smallValue = generateRandomValue(10)
  // Medium data size (1KB)
  const mediumValue = generateRandomValue(1024)
  // Large data size (64KB - 1KB to stay under the limit)
  const largeValue = generateRandomValue(64 * 1024 - 1024)

  // Prepare database and test data outside of benchmarks
  const db = await Valkeyrie.open()

  try {
    // Prepare keys for get benchmarks
    const getKeySmall = generateRandomKey()
    const getKeyMedium = generateRandomKey()
    const getKeyLarge = generateRandomKey()

    await db.set(getKeySmall, smallValue)
    await db.set(getKeyMedium, mediumValue)
    await db.set(getKeyLarge, largeValue)

    // Prepare keys for KvU64 benchmarks
    const kvU64Key = generateRandomKey()
    await db.set(kvU64Key, new KvU64(123456789n))

    // Benchmark set operations with different data sizes
    bench('set - small value (10B)', async () => {
      const key = generateRandomKey()
      await db.set(key, smallValue)
    })

    bench('set - medium value (1KB)', async () => {
      const key = generateRandomKey()
      await db.set(key, mediumValue)
    })

    bench('set - large value (64KB)', async () => {
      const key = generateRandomKey()
      await db.set(key, largeValue)
    })

    // Benchmark get operations with different data sizes
    bench('get - small value (10B)', async () => {
      await db.get(getKeySmall)
    })

    bench('get - medium value (1KB)', async () => {
      await db.get(getKeyMedium)
    })

    bench('get - large value (64KB)', async () => {
      await db.get(getKeyLarge)
    })

    // Benchmark delete operations
    bench('delete', async () => {
      const key = generateRandomKey()
      await db.set(key, smallValue)
      await db.delete(key)
    })

    // Benchmark KvU64 operations
    bench('KvU64 - set', async () => {
      const key = generateRandomKey()
      await db.set(key, new KvU64(123456789n))
    })

    bench('KvU64 - get', async () => {
      await db.get(kvU64Key)
    })

    // Run the benchmarks
    await run({
      colors: true,
      format: 'mitata',
    })
  } finally {
    await db.close()
  }
}

// Run the benchmarks
runBasicBenchmarks()
