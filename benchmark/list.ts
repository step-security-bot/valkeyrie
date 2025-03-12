import { bench, run } from 'mitata'
import { Valkeyrie } from '../src/valkeyrie.js'

// Setup data for list benchmarks
async function setupListData(db: Valkeyrie, prefix: string[], count: number) {
  for (let i = 0; i < count; i++) {
    await db.set([...prefix, i.toString()], `value-${i}`)
  }
}

// Benchmark for list operations
async function runListBenchmarks() {
  console.log('Running list operation benchmarks...')

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

// Run the benchmarks
runListBenchmarks()
