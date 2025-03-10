import { DatabaseSync } from 'node:sqlite'
import { deserialize, serialize } from 'node:v8'

interface DriverValue {
  key: Buffer
  value: Buffer
  versionstamp: string
}

type PrimitveValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Date
  | Uint8Array
  | ArrayBuffer
  | KvU64
type AcceptedValue =
  | PrimitveValue
  | AcceptedValue[]
  | { [key: string]: AcceptedValue }

export type KeyPart = string | number | boolean | Uint8Array | bigint
export type Key = KeyPart[]

interface Value<T = unknown> {
  key: Key
  value: T
  versionstamp: string
}

interface NullValue {
  key: Key
  value: null
  versionstamp: null
}

interface AtomicCheck {
  key: Key
  versionstamp: string | null
}

type ListSelector =
  | { prefix: Key }
  | { prefix: Key; start: Key }
  | { prefix: Key; end: Key }
  | { start: Key; end: Key }

interface ListOptions {
  limit?: number
  cursor?: string
  reverse?: boolean
  consistency?: 'strong' | 'eventual'
  batchSize?: number
}

interface SetOptions {
  expireIn?: number
}

interface Functions {
  close: () => Promise<void>
  get: (keyHash: string, now: number) => Promise<DriverValue | undefined>
  set: (
    keyHash: string,
    keyParts: Buffer,
    value: Buffer,
    versionstamp: string,
  ) => Promise<void>
  setWithExpiry: (
    keyHash: string,
    keyParts: Buffer,
    value: Buffer,
    versionstamp: string,
    expiresAt: number,
  ) => Promise<void>
  delete: (keyHash: string) => Promise<void>
  list: (
    startHash: string,
    endHash: string,
    prefixHash: string,
    now: number,
    limit: number,
  ) => Promise<DriverValue[]>
  listReverse: (
    startHash: string,
    endHash: string,
    prefixHash: string,
    now: number,
    limit: number,
  ) => Promise<DriverValue[]>
  cleanup: (now: number) => Promise<void>
  beginTransaction: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export function defineDriver(
  initDriver: ((path?: string) => Promise<Functions>) | Functions,
): (path?: string) => Promise<Functions> {
  if (initDriver instanceof Function) {
    return initDriver
  }

  return async () => initDriver
}

const sqliteDriver = defineDriver(async (path = ':memory:') => {
  const db = new DatabaseSync(path)
  // Enable WAL mode for better performance
  db.exec('PRAGMA journal_mode = WAL')

  // Create the KV table with versioning and expiry support
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key_hash TEXT PRIMARY KEY,
      key BLOB NOT NULL,
      value BLOB,
      versionstamp TEXT NOT NULL,
      expires_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at
    ON kv_store(expires_at)
    WHERE expires_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_kv_store_key_hash
    ON kv_store(key_hash);
  `)

  const statements = {
    get: db.prepare(
      'SELECT key, value, versionstamp FROM kv_store WHERE key_hash = ? AND (expires_at IS NULL OR expires_at > ?)',
    ),
    set: db.prepare(
      'INSERT OR REPLACE INTO kv_store (key_hash, key, value, versionstamp) VALUES (?, ?, ?, ?)',
    ),
    setWithExpiry: db.prepare(
      'INSERT OR REPLACE INTO kv_store (key_hash, key, value, versionstamp, expires_at) VALUES (?, ?, ?, ?, ?)',
    ),
    delete: db.prepare('DELETE FROM kv_store WHERE key_hash = ?'),
    list: db.prepare(
      'SELECT key, value, versionstamp FROM kv_store WHERE key_hash >= ? AND key_hash < ? AND key_hash != ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key_hash ASC LIMIT ?',
    ),
    listReverse: db.prepare(
      'SELECT key, value, versionstamp FROM kv_store WHERE key_hash >= ? AND key_hash < ? AND key_hash != ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key_hash DESC LIMIT ?',
    ),
    cleanup: db.prepare('DELETE FROM kv_store WHERE expires_at <= ?'),
  }

  // Prepare statements for better performance
  return {
    close: async () => db.close(),
    get: async (keyHash: string, now: number) =>
      statements.get.get(keyHash, now) as DriverValue | undefined,
    set: async (keyHash, key, serializedValue, versionstamp) => {
      statements.set.run(keyHash, key, serializedValue, versionstamp)
    },
    setWithExpiry: async (
      keyHash,
      key,
      serializedValue,
      versionstamp,
      expiresAt,
    ) => {
      statements.setWithExpiry.run(
        keyHash,
        key,
        serializedValue,
        versionstamp,
        expiresAt,
      )
    },
    delete: async (keyHash) => {
      statements.delete.run(keyHash)
    },
    list: async (startHash, endHash, prefixHash, now, limit) =>
      statements.list.all(
        startHash,
        endHash,
        prefixHash,
        now,
        limit,
      ) as DriverValue[],
    listReverse: async (startHash, endHash, prefixHash, now, limit) =>
      statements.listReverse.all(
        startHash,
        endHash,
        prefixHash,
        now,
        limit,
      ) as DriverValue[],
    cleanup: async (now) => {
      statements.cleanup.run(now)
    },
    beginTransaction: async () => {
      db.exec('BEGIN TRANSACTION')
    },
    commit: async () => {
      db.exec('COMMIT')
    },
    rollback: async () => {
      db.exec('ROLLBACK')
    },
  }
})

interface Check {
  key: Key
  versionstamp: string | null
}

export class KvU64 {
  readonly value: bigint

  constructor(value: bigint) {
    if (value < 0n) {
      throw new RangeError('Value must be non-negative')
    }
    if (value > 0xffffffffffffffffn) {
      throw new RangeError('Value must not exceed 64 bits')
    }
    this.value = value
  }

  valueOf(): bigint {
    return this.value
  }

  toString(): string {
    return this.value.toString()
  }

  toJSON(): string {
    return this.value.toString()
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `[KvU64: ${this.value}n]`
  }
}

export type Mutation = { key: Key } & (
  | { type: 'set'; value: AcceptedValue; expireIn?: number }
  | { type: 'delete' }
  | { type: 'sum'; value: KvU64 }
  | { type: 'max'; value: KvU64 }
  | { type: 'min'; value: KvU64 }
)

// Internal class - not exported
class Atomic {
  private checks: Check[] = []
  private mutations: Mutation[] = []
  private kv: Valkeyrie
  private totalMutationSize = 0
  private totalKeySize = 0

  constructor(kv: Valkeyrie) {
    this.kv = kv
  }

  private validateVersionstamp(versionstamp: string | null): void {
    if (versionstamp === null) return
    if (typeof versionstamp !== 'string') {
      throw new TypeError('Versionstamp must be a string or null')
    }
    if (versionstamp.length !== 20) {
      throw new TypeError('Versionstamp must be 20 characters long')
    }
    if (!/^[0-9a-f]{20}$/.test(versionstamp)) {
      throw new TypeError('Versionstamp must be a hex string')
    }
  }

  check(...checks: AtomicCheck[]): Atomic {
    for (const check of checks) {
      if (this.checks.length >= 100) {
        throw new TypeError('Max 100 checks per atomic operation')
      }
      this.kv.validateKeysAreArrays([check.key])
      this.validateVersionstamp(check.versionstamp)
      this.checks.push(check)
    }
    return this
  }

  mutate(...mutations: Mutation[]): Atomic {
    for (const mutation of mutations) {
      if (this.mutations.length >= 1000) {
        throw new TypeError('Max 1000 mutations per atomic operation')
      }
      this.kv.validateKeysAreArrays([mutation.key])
      if (mutation.key.length === 0) {
        throw new Error('Key cannot be empty')
      }

      // Track key size without validation
      const keySize = serialize(mutation.key).length
      this.totalKeySize += keySize

      // Track mutation size without validation
      let mutationSize = keySize
      if ('value' in mutation) {
        if (
          mutation.type === 'sum' ||
          mutation.type === 'max' ||
          mutation.type === 'min'
        ) {
          mutationSize += 8 // 64-bit integer size
        } else {
          mutationSize += serialize(mutation.value).length
        }
      }
      this.totalMutationSize += mutationSize

      // Validate mutation type and required fields
      switch (mutation.type) {
        case 'set':
          if (!('value' in mutation)) {
            throw new TypeError('Set mutation requires a value')
          }
          break
        case 'delete':
          if ('value' in mutation) {
            throw new TypeError('Delete mutation cannot have a value')
          }
          break
        case 'sum':
        case 'max':
        case 'min':
          if (!('value' in mutation) || !(mutation.value instanceof KvU64)) {
            throw new TypeError(
              `${mutation.type} mutation requires a KvU64 value`,
            )
          }
          break
        default:
          throw new TypeError('Invalid mutation type')
      }

      this.mutations.push(mutation)
    }
    return this
  }

  set(key: Key, value: AcceptedValue, options: SetOptions = {}): Atomic {
    return this.mutate({
      type: 'set',
      key,
      value,
      ...(options.expireIn ? { expireIn: options.expireIn } : {}),
    })
  }

  delete(key: Key): Atomic {
    return this.mutate({ type: 'delete', key })
  }

  sum(key: Key, value: bigint | KvU64): Atomic {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'sum', key, value: u64Value })
  }

  max(key: Key, value: bigint | KvU64): Atomic {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'max', key, value: u64Value })
  }

  min(key: Key, value: bigint | KvU64): Atomic {
    const u64Value = value instanceof KvU64 ? value : new KvU64(BigInt(value))
    return this.mutate({ type: 'min', key, value: u64Value })
  }

  async commit(): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    // Validate total sizes before executing the atomic operation
    if (this.totalKeySize > 81920) {
      throw new TypeError('Total key size too large (max 81920 bytes)')
    }
    if (this.totalMutationSize > 819200) {
      throw new TypeError('Total mutation size too large (max 819200 bytes)')
    }
    return this.kv.executeAtomicOperation(this.checks, this.mutations)
  }
}

export class Valkeyrie {
  private static internalConstructor = false
  private functions: Functions
  private lastVersionstamp: bigint
  private queueListeners: Set<(msg: unknown) => void> = new Set()

  private constructor(functions: Functions) {
    if (!Valkeyrie.internalConstructor) {
      throw new TypeError('Use Valkeyrie.open() to create a new instance')
    }
    this.functions = functions
    this.lastVersionstamp = 0n
  }

  public static async open(path?: string): Promise<Valkeyrie> {
    Valkeyrie.internalConstructor = true
    const db = new Valkeyrie(await sqliteDriver(path))
    Valkeyrie.internalConstructor = false
    return db
  }

  async close(): Promise<void> {
    this.queueListeners.clear()
    await this.functions.close()
  }

  listenQueue(callback: (msg: unknown) => void): Promise<void> {
    this.queueListeners.add(callback)
    return Promise.resolve()
  }

  async enqueue(
    value: AcceptedValue,
  ): Promise<{ ok: true; versionstamp: string }> {
    const versionstamp = this.generateVersionstamp()
    const key = ['__queue__', versionstamp]
    await this.set(key, value)

    // Notify all listeners
    for (const listener of this.queueListeners) {
      listener(value)
    }

    return { ok: true, versionstamp }
  }

  public validateKeysAreArrays(keys: unknown[]): asserts keys is Key[] {
    for (const key of keys) {
      if (!Array.isArray(key)) {
        throw new TypeError('Key must be an array')
      }
    }
  }

  private generateVersionstamp(): string {
    // Get current timestamp in microseconds
    const now = BigInt(Date.now()) * 1000n

    // Ensure monotonically increasing values even within the same microsecond
    this.lastVersionstamp =
      this.lastVersionstamp < now ? now : this.lastVersionstamp + 1n

    return this.lastVersionstamp.toString(16).padStart(20, '0')
  }

  private serializeKey(key: Key): Buffer {
    return serialize(key)
  }

  private deserializeKey(keyStr: Buffer): Key {
    return deserialize(keyStr)
  }

  private serializeValue(value: AcceptedValue): Buffer {
    const serialized = serialize(
      value instanceof KvU64
        ? { value: value.value, '$valkeyrie.u64': true }
        : value,
    )
    // 65536 + 7 bytes V8 serialization overhead
    if (serialized.length > 65536 + 7) {
      throw new TypeError('Value too large (max 65536 bytes)')
    }
    return serialized
  }

  private deserializeValue(value: Buffer): AcceptedValue {
    const d = deserialize(value)
    if (d && typeof d === 'object' && '$valkeyrie.u64' in d) {
      return new KvU64(d.value)
    }
    return d
  }

  private hashKey(key: Key): string {
    // Convert each key part to bytes following Deno KV's encoding format
    const parts = key.map((part) => {
      let bytes: Buffer

      if (part instanceof Uint8Array) {
        // Uint8Array format: 0x01 + bytes + 0x00
        bytes = Buffer.alloc(part.length + 2)
        bytes[0] = 0x01 // Uint8Array type marker
        Buffer.from(part).copy(bytes, 1)
        bytes[bytes.length - 1] = 0x00
      } else if (typeof part === 'string') {
        // String format: 0x02 + utf8 bytes + 0x00
        const strBytes = Buffer.from(part, 'utf8')
        bytes = Buffer.alloc(strBytes.length + 2)
        bytes[0] = 0x02 // String type marker
        strBytes.copy(bytes, 1)
        bytes[bytes.length - 1] = 0x00
      } else if (typeof part === 'bigint') {
        // Bigint format: 0x03 + 8 bytes int64 + 0x00
        bytes = Buffer.alloc(10)
        bytes[0] = 0x03 // Bigint type marker
        const hex = part.toString(16).padStart(16, '0')
        Buffer.from(hex, 'hex').copy(bytes, 1)
        bytes[bytes.length - 1] = 0x00
      } else if (typeof part === 'number') {
        // Number format: 0x04 + 8 bytes double + 0x00
        bytes = Buffer.alloc(10)
        bytes[0] = 0x04 // Number type marker
        bytes.writeDoubleBE(part, 1)
        bytes[bytes.length - 1] = 0x00
      } else if (typeof part === 'boolean') {
        // Boolean format: 0x05 + single byte + 0x00
        bytes = Buffer.alloc(3)
        bytes[0] = 0x05 // Boolean type marker
        bytes[1] = part ? 1 : 0
        bytes[bytes.length - 1] = 0x00
      } else {
        throw new Error(`Unsupported key part type: ${typeof part}`)
      }

      return bytes
    })

    // Join all parts with a null byte delimiter
    const fullKey = Buffer.concat([...parts])
    if (fullKey.length > 2048) {
      throw new TypeError('Key too large for write (max 2048 bytes)')
    }
    return fullKey.toString('base64').replace(/=+$/, '')
  }

  async get<T = unknown>(key: Key): Promise<Value<T> | NullValue> {
    this.validateKeysAreArrays([key])
    if (key.length === 0) {
      throw new Error('Key cannot be empty')
    }
    const keyHash = this.hashKey(key)
    const now = Date.now()
    const result = await this.functions.get(keyHash, now)

    if (!result) {
      return { key, value: null, versionstamp: null }
    }

    return {
      key: this.deserializeKey(result.key),
      value: this.deserializeValue(result.value) as T,
      versionstamp: result.versionstamp,
    }
  }

  async getMany(keys: Key[]): Promise<Array<Value<unknown> | NullValue>> {
    this.validateKeysAreArrays(keys)
    if (keys.length > 10) {
      throw new TypeError('Too many ranges (max 10)')
    }
    return Promise.all(keys.map((key) => this.get(key)))
  }

  async set<T extends AcceptedValue>(
    key: Key,
    value: T,
    options: SetOptions = {},
  ): Promise<{ ok: true; versionstamp: string }> {
    this.validateKeysAreArrays([key])
    if (key.length === 0) {
      throw new Error('Key cannot be empty')
    }
    const keyHash = this.hashKey(key)
    const keyParts = this.serializeKey(key)
    const serializedValue = this.serializeValue(value)
    const versionstamp = this.generateVersionstamp()

    if (options.expireIn) {
      const expiresAt = Date.now() + options.expireIn
      await this.functions.setWithExpiry(
        keyHash,
        keyParts,
        serializedValue,
        versionstamp,
        expiresAt,
      )
    } else {
      await this.functions.set(keyHash, keyParts, serializedValue, versionstamp)
    }

    return { ok: true, versionstamp }
  }

  async delete(key: Key): Promise<void> {
    this.validateKeysAreArrays([key])
    const keyHash = this.hashKey(key)
    await this.functions.delete(keyHash)
  }

  private validatePrefixKey(
    prefix: Key,
    key: Key,
    type: 'start' | 'end',
  ): void {
    if (key.length <= prefix.length) {
      throw new TypeError(
        `${type} key is not in the keyspace defined by prefix`,
      )
    }
    // Check if key has the same prefix
    const keyPrefix = key.slice(0, prefix.length)
    if (!keyPrefix.every((part, i) => part === prefix[i])) {
      throw new TypeError(
        `${type} key is not in the keyspace defined by prefix`,
      )
    }
  }

  private async *listBatch<T>(
    startHash: string,
    endHash: string,
    prefixHash: string,
    options: {
      limit: number
      batchSize: number
      reverse: boolean
    },
  ): AsyncIterableIterator<Value<T>> {
    const { limit, batchSize, reverse } = options
    if (batchSize > 1000) {
      throw new TypeError('Too many entries (max 1000)')
    }
    const now = Date.now()
    let remainingLimit = limit
    let currentStartHash = startHash
    let currentEndHash = endHash

    const list = reverse ? this.functions.listReverse : this.functions.list

    while (remainingLimit > 0) {
      const currentBatchSize = Math.min(batchSize, remainingLimit)
      const results = await list(
        currentStartHash,
        currentEndHash,
        prefixHash,
        now,
        currentBatchSize,
      )
      if (results.length === 0) break

      for (const result of results) {
        yield {
          key: this.deserializeKey(result.key),
          value: this.deserializeValue(result.value) as T,
          versionstamp: result.versionstamp,
        }
      }

      if (results.length < currentBatchSize) break
      remainingLimit -= results.length

      // Update hash bounds for next batch
      const lastResult = results[results.length - 1]
      if (!lastResult) break
      const lastKey = this.deserializeKey(lastResult.key)
      const lastKeyHash = this.hashKey(lastKey)
      if (reverse) {
        currentEndHash = lastKeyHash
      } else {
        currentStartHash = `${lastKeyHash}\0` // Use next possible hash value
      }
    }
  }

  private decodeCursorValue(cursor: string): string {
    const bytes = Buffer.from(cursor, 'base64')
    // Skip type marker (0x02) and get the value bytes (excluding terminator 0x00)
    return bytes.subarray(1, bytes.length - 1).toString('utf8')
  }

  private calculatePrefixBounds(
    prefix: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    const prefixHash = this.hashKey(prefix)

    if (cursor) {
      const cursorValue = this.decodeCursorValue(cursor)
      const cursorKey = [...prefix, cursorValue]
      const cursorHash = this.hashKey(cursorKey)

      return reverse
        ? { startHash: prefixHash, endHash: cursorHash }
        : { startHash: `${cursorHash}\0`, endHash: `${prefixHash}\xff` }
    }

    return {
      startHash: prefixHash,
      endHash: `${prefixHash}\xff`,
    }
  }

  private calculateRangeBounds(
    start: Key,
    end: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    // Compare start and end keys
    const startHash = this.hashKey(start)
    const endHash = this.hashKey(end)
    if (startHash > endHash) {
      throw new TypeError('Start key is greater than end key')
    }

    if (cursor) {
      const cursorValue = this.decodeCursorValue(cursor)
      // For range queries, we need to reconstruct the full key
      // by taking all parts from the start key except the last one
      // and appending the cursor value
      const cursorKey = [...start.slice(0, -1), cursorValue]
      const cursorHash = this.hashKey(cursorKey)

      return reverse
        ? { startHash, endHash: cursorHash }
        : { startHash: `${cursorHash}\0`, endHash }
    }

    return { startHash, endHash }
  }

  private calculateEmptyPrefixBounds(
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string } {
    if (cursor) {
      return reverse
        ? { startHash: '', endHash: cursor }
        : { startHash: `${cursor}\0`, endHash: '\uffff' }
    }

    return {
      startHash: '',
      endHash: '\uffff',
    }
  }

  private isPrefixWithStart(
    selector: ListSelector,
  ): selector is { prefix: Key; start: Key } {
    return 'prefix' in selector && 'start' in selector
  }

  private isPrefixWithEnd(
    selector: ListSelector,
  ): selector is { prefix: Key; end: Key } {
    return 'prefix' in selector && 'end' in selector
  }

  private isRangeSelector(
    selector: ListSelector,
  ): selector is { start: Key; end: Key } {
    return 'start' in selector && 'end' in selector
  }

  private validateSelector(selector: ListSelector): void {
    // Cannot have prefix + start + end together
    if ('prefix' in selector && 'start' in selector && 'end' in selector) {
      throw new TypeError('Cannot specify prefix with both start and end keys')
    }

    // Cannot have start without end (unless with prefix)
    if (
      !('prefix' in selector) &&
      'start' in selector &&
      !('end' in selector)
    ) {
      throw new TypeError('Cannot specify start key without prefix')
    }

    // Cannot have end without start (unless with prefix)
    if (
      !('prefix' in selector) &&
      !('start' in selector) &&
      'end' in selector
    ) {
      throw new TypeError('Cannot specify end key without prefix')
    }

    // Validate prefix constraints
    if ('prefix' in selector) {
      if ('start' in selector) {
        this.validatePrefixKey(selector.prefix, selector.start, 'start')
      }
      if ('end' in selector) {
        this.validatePrefixKey(selector.prefix, selector.end, 'end')
      }
    }
  }

  private getBoundsForPrefix(
    prefix: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string; prefixHash: string } {
    if (prefix.length === 0) {
      const bounds = this.calculateEmptyPrefixBounds(cursor, reverse)
      return { ...bounds, prefixHash: '' }
    }

    const prefixHash = this.hashKey(prefix)
    const bounds = this.calculatePrefixBounds(prefix, cursor, reverse)
    return { ...bounds, prefixHash }
  }

  private getBoundsForPrefixWithRange(
    prefix: Key,
    start: Key,
    end: Key,
    cursor?: string,
    reverse = false,
  ): { startHash: string; endHash: string; prefixHash: string } {
    const prefixHash = this.hashKey(prefix)
    const bounds = this.calculateRangeBounds(start, end, cursor, reverse)
    return { ...bounds, prefixHash }
  }

  list<T = unknown>(
    selector: ListSelector,
    options: ListOptions = {},
  ): AsyncIterableIterator<Value<T>> & { cursor: string } {
    this.validateSelector(selector)

    const { limit = 500, reverse = false, batchSize = 500, cursor } = options
    let bounds: { startHash: string; endHash: string; prefixHash: string }

    if (this.isRangeSelector(selector)) {
      bounds = this.getBoundsForPrefixWithRange(
        [],
        selector.start,
        selector.end,
        cursor,
        reverse,
      )
    } else if ('prefix' in selector) {
      if (this.isPrefixWithStart(selector)) {
        bounds = this.getBoundsForPrefixWithRange(
          selector.prefix,
          selector.start,
          [...selector.prefix, '\xff'],
          cursor,
          reverse,
        )
      } else if (this.isPrefixWithEnd(selector)) {
        bounds = this.getBoundsForPrefixWithRange(
          selector.prefix,
          selector.prefix,
          selector.end,
          cursor,
          reverse,
        )
      } else {
        bounds = this.getBoundsForPrefix(selector.prefix, cursor, reverse)
      }
    } else {
      throw new TypeError(
        'Invalid selector: must specify either prefix or start/end range',
      )
    }

    const generator = this.listBatch<T>(
      bounds.startHash,
      bounds.endHash,
      bounds.prefixHash,
      { limit, batchSize, reverse },
    )

    let lastKey: Key | null = null
    const self = this

    const wrapper = {
      [Symbol.asyncIterator]() {
        return this
      },
      async next() {
        const result = await generator.next()
        if (!result.done && result.value) {
          lastKey = result.value.key
        }
        return result
      },
      get cursor() {
        if (!lastKey) return ''
        const lastPart = lastKey[lastKey.length - 1]
        if (!lastPart) return ''
        return self.hashKey([lastPart])
      },
    } as AsyncIterableIterator<Value<T>> & { cursor: string }

    return wrapper
  }

  async cleanup(): Promise<void> {
    const now = Date.now()
    this.functions.cleanup(now)
  }

  atomic(): Atomic {
    return new Atomic(this)
  }

  // Friend method for Atomic class
  executeAtomicOperation(
    checks: Check[],
    mutations: Mutation[],
  ): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    return this.executeAtomic(checks, mutations)
  }

  private async executeAtomic(
    checks: Check[],
    mutations: Mutation[],
  ): Promise<{ ok: true; versionstamp: string } | { ok: false }> {
    const versionstamp = this.generateVersionstamp()

    try {
      await this.functions.beginTransaction()

      // Verify all checks pass within the transaction
      for (const check of checks) {
        const result = await this.get(check.key)
        if (result.versionstamp !== check.versionstamp) {
          await this.functions.rollback()
          return { ok: false }
        }
      }

      // Apply mutations - all using the same versionstamp
      for (const mutation of mutations) {
        const keyHash = this.hashKey(mutation.key)
        const keyParts = this.serializeKey(mutation.key)

        if (mutation.type === 'delete') {
          await this.functions.delete(keyHash)
        } else if (mutation.type === 'set') {
          const serializedValue = this.serializeValue(mutation.value)

          if (mutation.expireIn) {
            const expiresAt = Date.now() + mutation.expireIn
            await this.functions.setWithExpiry(
              keyHash,
              keyParts,
              serializedValue,
              versionstamp,
              expiresAt,
            )
          } else {
            await this.functions.set(
              keyHash,
              keyParts,
              serializedValue,
              versionstamp,
            )
          }
        } else if (
          mutation.type === 'sum' ||
          mutation.type === 'max' ||
          mutation.type === 'min'
        ) {
          const currentValue = await this.get(mutation.key)
          let newValue: KvU64

          if (currentValue.value === null) {
            newValue = mutation.value
          } else if (
            (mutation.type === 'sum' ||
              mutation.type === 'min' ||
              mutation.type === 'max') &&
            !(currentValue.value instanceof KvU64)
          ) {
            throw new TypeError(
              `Failed to perform '${mutation.type}' mutation on a non-U64 value in the database`,
            )
          } else if (
            typeof currentValue.value === 'number' ||
            typeof currentValue.value === 'bigint' ||
            currentValue.value instanceof KvU64
          ) {
            const current = BigInt(
              currentValue.value instanceof KvU64
                ? currentValue.value.value
                : currentValue.value,
            )
            if (mutation.type === 'sum') {
              newValue = new KvU64(
                (current + mutation.value.value) & 0xffffffffffffffffn,
              )
            } else if (mutation.type === 'max') {
              newValue = new KvU64(
                current > mutation.value.value ? current : mutation.value.value,
              )
            } else {
              newValue = new KvU64(
                current < mutation.value.value ? current : mutation.value.value,
              )
            }
          } else {
            throw new TypeError(
              `Invalid value type for ${mutation.type} operation`,
            )
          }

          // Store the KvU64 instance directly
          const serializedValue = this.serializeValue(newValue)
          await this.functions.set(
            keyHash,
            keyParts,
            serializedValue,
            versionstamp,
          )
        }
      }

      await this.functions.commit()
      return { ok: true, versionstamp }
    } catch (error) {
      await this.functions.rollback()
      if (error instanceof TypeError) {
        throw error
      }
      return { ok: false }
    }
  }
}
