/**
 * mockCache vs DB coherence without Mongo: models are mocked.
 */
const projectFindOne = jest.fn();
const mockApiFindOne = jest.fn();
const endpointFind = jest.fn();
const configFindOne = jest.fn();

jest.mock('../models/Project.js', () => ({
  ProjectModel: { findById: jest.fn(), findOne: (...a: unknown[]) => projectFindOne(...a) },
}));
jest.mock('../models/MockAPI.js', () => ({
  MockAPIModel: { findOne: (...a: unknown[]) => mockApiFindOne(...a) },
  EndpointModel: { find: (...a: unknown[]) => endpointFind(...a) },
}));
jest.mock('../models/EndpointConfig.js', () => ({
  EndpointConfigModel: { findOne: (...a: unknown[]) => configFindOne(...a) },
}));

import { mockCache } from '../modules/mock/mockCache.service.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('mockCache coherence', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockCache.clearAll();
  });

  it('serves from cache, then reloads after invalidateEndpointConfig', async () => {
    configFindOne.mockResolvedValueOnce({ delay_ms: 1 }).mockResolvedValueOnce({ delay_ms: 2 });
    expect((await mockCache.getEndpointConfig('e1'))?.delay_ms).toBe(1);
    expect((await mockCache.getEndpointConfig('e1'))?.delay_ms).toBe(1);
    expect(configFindOne).toHaveBeenCalledTimes(1);
    mockCache.invalidateEndpointConfig('e1');
    expect((await mockCache.getEndpointConfig('e1'))?.delay_ms).toBe(2);
  });

  it('an in-flight read that started before an invalidation does not write stale data back', async () => {
    const d = deferred<any>();
    configFindOne.mockReturnValueOnce(d.promise).mockResolvedValueOnce({ delay_ms: 99 });
    const inflight = mockCache.getEndpointConfig('e1'); // reads old value from DB
    mockCache.invalidateEndpointConfig('e1'); // endpoint updated while the read is running
    d.resolve({ delay_ms: 1 }); // stale result arrives afterwards
    await inflight;
    expect((await mockCache.getEndpointConfig('e1'))?.delay_ms).toBe(99);
  });

  it('invalidateMockApi drops the cached endpoint list and ignores stale in-flight loads', async () => {
    const stale = [{ path: '/old' }];
    const fresh = [{ path: '/new' }];
    const d = deferred<any>();
    endpointFind.mockReturnValueOnce(d.promise).mockReturnValueOnce(fresh);
    const inflight = mockCache.getEndpoints('api1');
    mockCache.invalidateMockApi('api1');
    d.resolve(stale);
    await inflight;
    expect(await mockCache.getEndpoints('api1')).toEqual(fresh);
  });

  it('invalidateProject clears cached keys even when the DB fails (falls back to clearing everything)', async () => {
    projectFindOne.mockResolvedValueOnce({ _id: { toString: () => 'p1' }, slug: 's' });
    await mockCache.getProject('s');
    mockApiFindOne.mockRejectedValue(new Error('db down'));
    await expect(mockCache.invalidateProject('s')).resolves.toBeUndefined();
    projectFindOne.mockResolvedValueOnce(null);
    expect(await mockCache.getProject('s')).toBeNull();
  });
});
