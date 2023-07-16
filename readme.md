# simple-localstorage-cache

A simple local-storage cache with time based expiration policies

# features

- simplicity: `get`, `set`, and `keys` with an intuitive, pit-of-success, implementation
- interoperability: fulfills the standard [SimpleAsyncCache](https://github.com/ehmpathy/with-simple-caching/blob/main/src/domain/SimpleCache.ts#L9-L15) interface
  - can be used with
    - [with-simple-caching](https://github.com/ehmpathy/with-simple-caching)
    - [cache-dao-generator](https://github.com/ehmpathy/simple-cache-dao)
- garbage collection: automatically removes expired keys from local-storage to free up space

# install

```
npm install simple-localstorage-cache
```

# use

### create a cache

```ts
const cache = createCache({ namespace: 'super-awesome-feature' });
```

### set to the cache

```ts
await cache.set('answer', 42);
```

***ℹ️ note: if you'd like an item to never expire, set the expiration time to `null` or `Infinity`***

### get from the cache

```ts
await cache.get('answer'); // 42
```
