import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/authenticateToken.js';
import {
  createCredential,
  deleteCredential,
  getConfig,
  listCredentials,
  updateCredential,
  type CreateCredentialInput,
  type UpdateCredentialInput,
} from './service.js';
import { notifyKeyAdded, notifyKeyRemoved } from './notices.js';

const ok = (res: Response, status: number, data: unknown) =>
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });

export function getConfigHandler(_req: AuthenticatedRequest, res: Response): void {
  ok(res, 200, getConfig());
}

export async function listHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  ok(res, 200, await listCredentials(req.user!.id));
}

export async function createHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const created = await createCredential(userId, req.body as CreateCredentialInput);
  await notifyKeyAdded(userId, created.providerName, created.meta.label);
  ok(res, 201, created.meta);
}

export async function updateHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  ok(
    res,
    200,
    await updateCredential(req.user!.id, req.params.id, req.body as UpdateCredentialInput)
  );
}

export async function deleteHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const removed = await deleteCredential(userId, req.params.id);
  await notifyKeyRemoved(userId, removed.providerName, removed.label);
  res.status(204).send();
}
