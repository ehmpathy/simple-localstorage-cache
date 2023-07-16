import Bottleneck from 'bottleneck';
import { withNot } from 'type-fns';

const updateValidKeysBottleneck = new Bottleneck({ maxConcurrent: 1 });

export interface SimpleLocalStorageCache {
  /**
   * get a value from cache by key
   */
  get: (key: string) => Promise<string | undefined>;

  /**
   * set a value to cache for key
   */
  set: (
    key: string,
    value: string | undefined,
    options?: { secondsUntilExpiration?: number },
  ) => Promise<void>;

  /**
   * list all valid keys in cache
   */
  keys: () => Promise<string[]>;
}

/**
 * the key under which to persist the valid_keys metadata
 */
const RESERVED_CACHE_KEY_FOR_VALID_KEYS = 'keys';

/**
 * the shape of a key with metadata
 */
interface KeyWithMetadata {
  key: string;
  expiresAtMse: number | null;
}

const getMseNow = () => new Date().getTime();

/**
 * a utility function for deciding whether a record is valid
 */
export const isRecordExpired = ({
  expiresAtMse,
}: {
  expiresAtMse: number | null;
}) => {
  // if expiresAtMse = null, then it never expires
  if (expiresAtMse === null) return false;

  // otherwise, check whether its expired
  return expiresAtMse < getMseNow();
};

export const createCache = ({
  namespace,
  defaultSecondsUntilExpiration = 5 * 60,
}: {
  /**
   * specifies the namespace under which cached items will be persisted in the localstorage
   *
   * for example
   * - namespace = 'likes' && key = 'donuts' => localstorage cache key = `cache:likes:donuts`
   */
  namespace: string;

  /**
   * specifies the default number of seconds until a record is considered expired
   *
   * note
   * - use `null` for "never expire"
   */
  defaultSecondsUntilExpiration?: number | null;
}): SimpleLocalStorageCache => {
  // define how to get the full cache key
  const getCacheKey = (key: string) => ['cache', namespace, key].join(':');

  // define how to set an item into the cache
  const set = (
    key: string,
    value: string | undefined,
    {
      secondsUntilExpiration = defaultSecondsUntilExpiration,
    }: { secondsUntilExpiration?: number | null } = {},
  ): KeyWithMetadata => {
    const cacheKey = getCacheKey(key);

    // handle cache invalidation
    if (value === undefined) {
      window.localStorage.removeItem(cacheKey);
      return { key, expiresAtMse: 0 };
    }

    // handle setting
    const expiresAtMse = secondsUntilExpiration
      ? getMseNow() + secondsUntilExpiration * 1000
      : null;
    const serializedValue = JSON.stringify({
      expiresAtMse,
      value,
    });
    window.localStorage.setItem(cacheKey, serializedValue);

    // return the key with metadata
    return {
      key,
      expiresAtMse,
    };
  };

  // define how to get an item from the cache
  const get = (key: string) => {
    const cacheKey = getCacheKey(key);
    const cacheContentJSON = window.localStorage.getItem(cacheKey);
    if (!cacheContentJSON) return undefined; // if not in cache, then undefined
    const cacheContent = JSON.parse(cacheContentJSON);
    if (isRecordExpired(cacheContent)) return undefined; // if already expired, then undefined
    return cacheContent.value; // otherwise, its in the cache and not expired, so return the value
  };

  /**
   * define how to lookup valid keys for the cache
   */
  const getValidKeysWithMetadata = async () => {
    // lookup the last saved valid keys
    const cachedKeyMetadataJSON = await get(RESERVED_CACHE_KEY_FOR_VALID_KEYS);
    const cachedKeyMetadata: KeyWithMetadata[] = cachedKeyMetadataJSON
      ? JSON.parse(cachedKeyMetadataJSON)
      : [];

    // purge expired keys
    const cachedExpiredKeys = cachedKeyMetadata.filter(isRecordExpired);
    cachedExpiredKeys.map(({ key }) => set(key, undefined));

    // return the valid keys
    const validKeyMetadata = cachedKeyMetadata.filter(withNot(isRecordExpired));
    return validKeyMetadata;
  };

  /**
   * define how to save valid keys for the cache
   *
   * note
   * - record a key w/ effectiveAtMse = 0 to invalidate it
   *
   * TODO: eventually, support lossless high-concurrency writing (potentially optionally, as a cache option, since it's not important for most applications)
   * - we need some way of ensuring that parallel processes wont conflict + overwrite eachother
   *   - for example, imagine you have two keys that were set to cache in parallel
   *     - requestA = [...savedKeys, newKeyA]
   *     - requestB = [...savedKeys, newKeyB]
   *     - read-before-write would make it so that either newKeyA or newKeyB is dropped and doesn't make it to the final destination // TODO: lookup the formal word for this race condition, its common in dbs
   *   - in other words,
   *     - there is a risk a query _will_ have been cached but not saved to the valid keys -> immediately invalidated
   *     - this is a safe failure mode, as it's the same as the query never having been cached in the first place (i.e., just requires extra requests)
   *   - if we find a usecase where it _is_ critical to solve, we can do so
   *     - probably with
   *       - per-thread "append" file (which all read from, but only one thread writes to)  (similar in spi)
   *       - plus
   *       - globally locked global file update, similar to
   *       - inspiration: https://stackoverflow.com/a/53193851/3068233
   */
  const updateKeyWithMetadataState = async ({
    for: forKeyWithMetadata,
  }: {
    for: KeyWithMetadata;
  }) => {
    // write inside of a bottleneck, to ensure that within one runtime no more than one process is writing to that same key; prevents same-runtime race conditions
    return updateValidKeysBottleneck.schedule(async () => {
      // lookup current valid keys
      const currentKeysWithMetadata = await getValidKeysWithMetadata();

      // save the keys w/ an extra key
      await set(
        RESERVED_CACHE_KEY_FOR_VALID_KEYS,
        JSON.stringify([
          // save the current keys, excluding the previous state of this key if it was there
          ...currentKeysWithMetadata.filter(
            ({ key }) => key !== forKeyWithMetadata.key, // filter out prior state for this key, if any
          ),

          // save this key, if it isn't expired
          ...(isRecordExpired(forKeyWithMetadata) ? [] : [forKeyWithMetadata]),
        ]),
        { secondsUntilExpiration: null },
      );
    });
  };

  /**
   * define how to set an item to the cache, with valid key tracking
   */
  const setWithValidKeyTracking = async (
    ...args: Parameters<typeof set>
  ): Promise<void> => {
    // write to the cache
    const newKeyWithMetadata = await set(...args);

    // add the key as valid
    await updateKeyWithMetadataState({ for: newKeyWithMetadata });
  };

  /**
   * define how to get valid keys
   */
  const getValidKeys = async () => {
    const keysWithMetadata = await getValidKeysWithMetadata();
    return keysWithMetadata.map(({ key }) => key);
  };

  /**
   * define how to get an item from the cache, synced with valid key tracking
   */
  const getWithValidKeyTracking = async (
    ...args: Parameters<typeof get>
  ): Promise<ReturnType<typeof get>> => {
    // if its not a valid key, then dont try to get (this is critical, as it ensures that the validKeys array is a source of truth)
    const validKeys = await getValidKeys();
    if (!validKeys.includes(args[0])) return undefined; // if the key is not valid, then no value

    // otherwise, lookup the value
    return get(...args);
  };

  /**
   * return the api
   */
  return {
    set: setWithValidKeyTracking,
    get: getWithValidKeyTracking,
    keys: getValidKeys,
  };
};
