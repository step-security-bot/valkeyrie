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

// Setup data for list benchmarks
async function setupListData(db: Valkeyrie, prefix: string[], count: number) {
  for (let i = 0; i < count; i++) {
    await db.set([...prefix, i.toString()], `value-${i}`)
  }
}

// Run all benchmarks
async function runAllBenchmarks() {
  console.log('Running all benchmarks...')

  // Basic operations benchmarks
  await runBasicBenchmarks()

  // List operations benchmarks
  await runListBenchmarks()

  // Atomic operations benchmarks
  await runAtomicBenchmarks()
}

// Basic operations benchmarks
async function runBasicBenchmarks() {
  console.log('\nRunning basic operation benchmarks...')

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

// List operations benchmarks
async function runListBenchmarks() {
  console.log('\nRunning list operation benchmarks...')

  // Prepare database and test data outside of benchmarks
  const db = await Valkeyrie.open()

  try {
    // Setup data for different list sizes
    const smallPrefix = ['list', 'small']
    const mediumPrefix = ['list', 'medium']
    const largePrefix = ['list', 'large']
    const limitPrefix = ['list', 'limit']
    const reversePrefix = ['list', 'reverse']
    const arrayPrefix = ['list', 'array']

    // Setup test data
    await setupListData(db, smallPrefix, 10)
    await setupListData(db, mediumPrefix, 100)
    await setupListData(db, largePrefix, 1000)
    await setupListData(db, limitPrefix, 1000)
    await setupListData(db, reversePrefix, 100)
    await setupListData(db, arrayPrefix, 100)

    // Benchmark list operations with different sizes
    bench('list - small (10 items)', async () => {
      const items = []
      for await (const item of db.list({ prefix: smallPrefix })) {
        items.push(item)
      }
    })

    bench('list - medium (100 items)', async () => {
      const items = []
      for await (const item of db.list({ prefix: mediumPrefix })) {
        items.push(item)
      }
    })

    bench('list - large (1000 items)', async () => {
      const items = []
      for await (const item of db.list({ prefix: largePrefix })) {
        items.push(item)
      }
    })

    // Benchmark list with limit
    bench('list - with limit (10)', async () => {
      const items = []
      for await (const item of db.list(
        { prefix: limitPrefix },
        { limit: 10 },
      )) {
        items.push(item)
      }
    })

    bench('list - with limit (100)', async () => {
      const items = []
      for await (const item of db.list(
        { prefix: limitPrefix },
        { limit: 100 },
      )) {
        items.push(item)
      }
    })

    // Benchmark list with reverse
    bench('list - reverse', async () => {
      const items = []
      for await (const item of db.list(
        { prefix: reversePrefix },
        { reverse: true },
      )) {
        items.push(item)
      }
    })

    // Benchmark Array.fromAsync with list
    bench('Array.fromAsync - small list', async () => {
      await Array.fromAsync(db.list({ prefix: smallPrefix }))
    })

    bench('Array.fromAsync - medium list', async () => {
      await Array.fromAsync(db.list({ prefix: arrayPrefix }))
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

// Atomic operations benchmarks
async function runAtomicBenchmarks() {
  console.log('\nRunning atomic operation benchmarks...')

  // Prepare database and test data outside of benchmarks
  const db = await Valkeyrie.open()

  try {
    // Prepare keys for atomic operations
    const key1 = generateRandomKey()
    const key2 = generateRandomKey()
    const key3 = generateRandomKey()
    const key4 = generateRandomKey()
    const key5 = generateRandomKey()

    // Set initial values
    await db.set(key1, 'value1')
    await db.set(key2, 'value2')
    await db.set(key3, new KvU64(10n))
    await db.set(key4, new KvU64(20n))
    await db.set(key5, new KvU64(30n))

    // Get entry for check operations
    const entry1 = await db.get(key1)

    // Benchmark single atomic operation
    bench('atomic - single set', async () => {
      await db.atomic().set(generateRandomKey(), 'value').commit()
    })

    // Benchmark multiple atomic operations
    bench('atomic - multiple set (5)', async () => {
      await db
        .atomic()
        .set(generateRandomKey(), 'value1')
        .set(generateRandomKey(), 'value2')
        .set(generateRandomKey(), 'value3')
        .set(generateRandomKey(), 'value4')
        .set(generateRandomKey(), 'value5')
        .commit()
    })

    // Benchmark atomic check and set
    bench('atomic - check and set', async () => {
      await db
        .atomic()
        .check({ key: key1, versionstamp: entry1.versionstamp })
        .set(key1, 'new-value')
        .commit()
    })

    // Benchmark atomic delete
    bench('atomic - delete', async () => {
      const tempKey = generateRandomKey()
      await db.set(tempKey, 'temp-value')
      await db.atomic().delete(tempKey).commit()
    })

    // Benchmark atomic sum operation
    bench('atomic - sum', async () => {
      await db.atomic().sum(key3, 5n).commit()
    })

    // Benchmark atomic max operation
    bench('atomic - max', async () => {
      await db.atomic().max(key4, 25n).commit()
    })

    // Benchmark atomic min operation
    bench('atomic - min', async () => {
      await db.atomic().min(key5, 15n).commit()
    })

    // Benchmark complex atomic operation
    bench('atomic - complex (mixed operations)', async () => {
      await db
        .atomic()
        .check({ key: key1, versionstamp: entry1.versionstamp })
        .set(generateRandomKey(), 'new-value')
        .delete(key2)
        .sum(key3, 1n)
        .max(key4, 30n)
        .min(key5, 10n)
        .commit()
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

// Run all benchmarks
runAllBenchmarks()
