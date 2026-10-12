# IndexedDB storage

IndexedDbDatabase binds consumer-owned table row/key types and schema indexes to
the existing Dexie implementation. Canvas One supplies its unchanged database
name, version and complete schema, preserving existing transaction scopes.
Dexie exception classification lives here, outside headless storage.

IndexedDbBackend also implements the generic atomic row-store port with
out-of-line keys, sharing conformance tests with MemoryBackend. This separate
backend does not migrate or replace the existing application database schema.
Passing an existing Dexie database instead of a name adapts its current tables
without changing their schema/version. Inline-key writes verify the supplied
key agrees with the row; scans and declared index queries preserve native key
ordering. The application uses this adapter for project catalog reads.
Hosts explicitly close/delete their own database instances.
Transaction callbacks await only scoped store operations. Compute hashes and
await network, timers or workers before entering an IndexedDB transaction;
native IndexedDB lifetime rules still apply.
