import { Router } from 'express';
import { getTestOutbox, clearTestOutbox, isOutboxEnabled } from '../../services/mailer.js';
import { createDemoMock, type DemoEndpoint } from '../demo/mockStore.js';

/**
 * Test-only access to the in-memory mail outbox, mounted at /api/__test__ (see index.ts).
 *
 * Why: the e2e suite (Cypress) has no SMTP server, yet it must follow the links of the verification and password
 * reset emails. With E2E_EXPOSE_MAIL_OUTBOX=true the mailer keeps the messages in memory and this router lets the
 * spec read (GET) and empty (DELETE) them.
 *
 * It is mounted ONLY when NODE_ENV=test or E2E_EXPOSE_MAIL_OUTBOX=true, and NEVER in production: the emails carry
 * password-reset links, so exposing them would be an account takeover. assertProdConfig also refuses to boot in
 * production with the flag set.
 */
export function shouldMountTestOutbox(env: NodeJS.ProcessEnv = process.env): boolean {
  return isOutboxEnabled(env);
}

export const testOutboxRouter = Router();

/** GET /api/__test__/outbox -> { success, data: OutboxEntry[] } (oldest first) */
testOutboxRouter.get('/outbox', (_req, res) => {
  res.status(200).json({ success: true, data: getTestOutbox(), timestamp: new Date().toISOString() });
});

/** DELETE /api/__test__/outbox -> 204 */
testOutboxRouter.delete('/outbox', (_req, res) => {
  clearTestOutbox();
  res.status(204).send();
});

/** What the e2e suite's demo mock answers (a tiny shop: enough to check it survives the claim). */
const E2E_DEMO_ENDPOINTS: DemoEndpoint[] = [
  { method: 'GET', path: '/products', statusCode: 200, body: [{ id: 1, name: 'E2E mug' }] },
  { method: 'GET', path: '/products/:id', statusCode: 200, body: { id: 1, name: 'E2E mug' } },
  { method: 'POST', path: '/orders', statusCode: 201, body: { id: 77, status: 'created' } },
];

/**
 * POST /api/__test__/demo-mock -> 201 { success, data: { demoId } }
 * Creates a real ephemeral demo mock WITHOUT going through the AI (the e2e suite has no model), so the spec can walk the
 * whole "build a demo, sign up, keep it" path against the real claim endpoint. Same mount condition as the outbox.
 */
testOutboxRouter.post('/demo-mock', async (_req, res, next) => {
  try {
    const { demoId } = await createDemoMock('e2e-visitor', E2E_DEMO_ENDPOINTS);
    res.status(201).json({ success: true, data: { demoId }, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});
