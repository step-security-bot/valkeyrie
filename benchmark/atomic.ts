import { bench, run } from 'mitata'
import { KvU64 } from '../src/kv-u64.js'
import { Valkeyrie } from '../src/valkeyrie.js'

// Helper to generate random keys
function generateRandomKey(length = 1): string[] {
  return Array.from({ length }, () =>
    Math.random().toString(36).substring(2, 15),
  )
}

// Benchmark for atomic operations
async function runAtomicBenchmarks() {
  console.log('Running atomic operation benchmarks...')

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

// Run the benchmarks
runAtomicBenchmarks()
