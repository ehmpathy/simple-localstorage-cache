/**
 * @jest-environment jsdom
 */
import { v4 as uuid } from 'uuid';

import { createCache } from './cache';

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

jest.setTimeout(30 * 1000); // give up to 60 seconds, since we deal with timeouts that we want to test on the ~15 second range

// mock out the localstorage object we're accessing in the utility
const mockStore: Record<string, string> = {};
const mockGetItem = jest.fn((key: string) => mockStore[key]);
const mockSetItem = jest.fn(
  (key: string, value: string) => (mockStore[key] = value),
);
const mockRemoveItem = jest.fn((key: string) => {
  delete mockStore[key];
});
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: mockGetItem,
    setItem: mockSetItem,
    removeItem: mockRemoveItem,
  },
});

describe('cache', () => {
  it('should be able to add an item to the cache', async () => {
    const { set } = createCache({ namespace: uuid() });
    await set('meaning of life', '42');
  });
  it('should be able to get an item from the cache', async () => {
    const { set, get } = createCache({ namespace: uuid() });
    await set(
      'how many licks does it take to get to the center of a tootsie pop?',
      '3',
    );
    const licks = await get(
      'how many licks does it take to get to the center of a tootsie pop?',
    );
    expect(licks).toEqual('3');
  });
  it('should respect the default expiration for the cache', async () => {
    const { set, get } = createCache({
      namespace: uuid(),
      defaultSecondsUntilExpiration: 10, // we're gonna use this cache to keep track of the popcorn in the microwave - we should check more regularly since it changes quickly!
    });
    await set('how popped is the popcorn?', 'not popped');

    // prove that we recorded the value and its accessible immediately after setting
    const popcornStatus = await get('how popped is the popcorn?');
    expect(popcornStatus).toEqual('not popped');

    // prove that the value is still accessible after 9 seconds, since default ttl is 10 seconds
    await sleep(9 * 1000);
    const popcornStatusAfter9Sec = await get('how popped is the popcorn?');
    expect(popcornStatusAfter9Sec).toEqual('not popped'); // still should say not popped

    // and prove that after a total of 9 seconds, the status is no longer in the cache
    await sleep(1 * 1000); // sleep 1 more second
    const popcornStatusAfter10Sec = await get('how popped is the popcorn?');
    expect(popcornStatusAfter10Sec).toEqual(undefined); // no longer defined, since the default seconds until expiration was 15
  });
  it('should respect the item level expiration for the cache', async () => {
    const { set, get } = createCache({ namespace: uuid() });
    await set('ice cream state', 'solid', { secondsUntilExpiration: 5 }); // ice cream changes quickly in the heat! lets keep a quick eye on this

    // prove that we recorded the value and its accessible immediately after setting
    const iceCreamState = await get('ice cream state');
    expect(iceCreamState).toEqual('solid');

    // prove that the value is still accessible after 4 seconds, since default ttl is 5 seconds
    await sleep(4 * 1000);
    const iceCreamStateAfter4Sec = await get('ice cream state');
    expect(iceCreamStateAfter4Sec).toEqual('solid'); // still should say solid

    // and prove that after a total of 5 seconds, the state is no longer in the cache
    await sleep(1 * 1000); // sleep 1 more second
    const iceCreamStateAfter5Sec = await get('ice cream state');
    expect(iceCreamStateAfter5Sec).toEqual(undefined); // no longer defined, since the item level seconds until expiration was 5
  });
  it('should accurately get keys', async () => {
    // create the cache
    const { set, keys } = createCache({ namespace: uuid() });

    // check key is added when value is set
    await set('meaning-of-life', '42');
    const keys1 = await keys();
    expect(keys1.length).toEqual(1);
    expect(keys1[0]).toEqual('meaning-of-life');

    // check that there are no duplicates when key value is updated
    await set('meaning-of-life', '42.0');
    const keys2 = await keys();
    expect(keys2.length).toEqual(1);
    expect(keys2[0]).toEqual('meaning-of-life');

    // check that multiple keys can be set
    await set('purpose-of-life', 'propagation');
    const keys3 = await keys();
    expect(keys3.length).toEqual(2);
    expect(keys3[1]).toEqual('purpose-of-life');

    // check that invalidation removes the key
    await set('meaning-of-life', undefined);
    const keys4 = await keys();
    expect(keys4.length).toEqual(1);
    expect(keys4[0]).toEqual('purpose-of-life');
  });
});
