import request from 'supertest';
import app from '../index.js';

/**
 * /api/github/parse probes GitHub and /api/github/ingest clones a repository on this server: both cost bandwidth,
 * disk and the GitHub API quota, so only signed-in users may call them (the SPA always sends its Bearer token).
 */
describe('GitHub routes require authentication', () => {
  let errorSpy: jest.SpyInstance;
  beforeAll(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => errorSpy.mockRestore());

  it('POST /api/github/parse without a token is 401', async () => {
    const res = await request(app).post('/api/github/parse').send({ url: 'https://github.com/octocat/Hello-World' });
    expect(res.status).toBe(401);
  });

  it('POST /api/github/ingest without a token is 401', async () => {
    const res = await request(app).post('/api/github/ingest').send({ url: 'https://github.com/octocat/Hello-World' });
    expect(res.status).toBe(401);
  });

  it('POST /api/github/ingest with an invalid token is 401', async () => {
    const res = await request(app)
      .post('/api/github/ingest')
      .set('Authorization', 'Bearer not.a.valid.token')
      .send({ url: 'https://github.com/octocat/Hello-World' });
    expect(res.status).toBe(401);
  });
});
