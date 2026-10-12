import crypto from 'crypto';
import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import type { Project as ProjectDTO } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import {
  DemoMockModel,
  type DemoEndpointDocument,
  type DemoMockDocument,
} from '../../models/DemoMock.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { ProjectModel } from '../../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../../models/MockAPI.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { deleteProjectsCascade } from '../projects/cascade.js';
import { createProject } from '../projects/service.js';
import {
  getProjectLimitState,
  planLimitMessage,
  type ProjectLimitState,
} from '../../middlewares/planGate.js';
import { hashClaimToken, isClaimToken, isDemoId } from './mockStore.js';

/**
 * Turning a visitor's ephemeral demo mock into a real project of their account (task B6).
 *
 * Two different 128-bit values (task L1). The demo id is PUBLIC: it is in the URL of the visitor's mock and the mock
 * may be shared, so it proves nothing. The claim token is the secret: it is handed out once, in the generate response,
 * and DemoMock keeps only its SHA-256, compared in constant time. A missing or wrong token answers the same 404 as "no
 * such demo" and neither consumes nor deletes the demo. Nothing lists demos.
 *
 * The claim is ATOMIC: the mock is taken with one findOneAndDelete, so however many requests race for the same id at
 * most one gets it (and creates at most one project). If creating the project then fails the mock is put back exactly
 * as it was (same id, same expiry and request count), so a plan-limit refusal or a database hiccup never costs the
 * visitor their demo. The claim spends no AI quota and no demo budget: it copies what the demo already produced.
 *
 * The project limit is strict here (it was a soft count-then-create): claims of one account run one at a time in this
 * process, and after creating the project the active ones are counted again. If another server process got in
 * between and the account is over its limit, the new project is deleted (archived if the delete fails), the demo is
 * restored with its original expiry and the answer is 402 PLAN_LIMIT_REACHED.
 */

/** Marks an account that ended up over its project limit because of a concurrent create. */
class OverLimit extends Error {
  constructor(readonly state: ProjectLimitState) {
    super('over project limit');
  }
}

/** The same 402 body the plan gate sends (details included), so the panel treats both identically. */
const planLimitReached = (state: ProjectLimitState) =>
  new AppError(planLimitMessage(state), 'PLAN_LIMIT_REACHED' as ErrorCode, 402, {
    plan: state.plan,
    limit: state.limit,
    active: state.active,
  });

/** One claim at a time per account inside this process (a chain of promises; entries are removed when idle). */
const userQueues = new Map<string, Promise<unknown>>();
async function withUserLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => undefined);
  userQueues.set(userId, tail);
  try {
    return await run;
  } finally {
    if (userQueues.get(userId) === tail) userQueues.delete(userId);
  }
}

/** Longest project title a claim writes (the plain create route allows 100). */
export const CLAIM_TITLE_MAX = 60;

/** One answer for "never existed", "expired" and "already claimed": the caller cannot tell which. */
const notFound = () => new AppError('This demo is no longer available.', ErrorCode.NOT_FOUND, 404);

/**
 * "Demo - <first resource>", e.g. GET /products/:id -> "Demo - products". Only the first static path segment of the
 * first endpoint is used (paths are restricted to a safe alphabet when the demo is created), never the visitor's text.
 */
export function claimTitle(endpoints: Pick<DemoEndpointDocument, 'path'>[]): string {
  const segment = (endpoints[0]?.path ?? '').split('/').find((s) => s !== '' && !s.startsWith(':'));
  const clean = (segment ?? '')
    .replace(/[^A-Za-z0-9._~@-]/g, '')
    .slice(0, CLAIM_TITLE_MAX - 'Demo - '.length);
  return clean ? `Demo - ${clean}` : 'Demo';
}

/** Writes the demo's endpoints under the project's MockAPI exactly like the AI pipeline does (Endpoint -> Response). */
async function populate(
  projectId: string,
  endpoints: DemoEndpointDocument[],
  createdResponseIds: Types.ObjectId[]
): Promise<void> {
  const projectObjectId = new Types.ObjectId(projectId);
  // createProject makes it, but tolerates a failure of that secondary document
  let mockApi = await MockAPIModel.findOne({ projectId: projectObjectId });
  if (!mockApi) {
    mockApi = await MockAPIModel.create({
      projectId: projectObjectId,
      title: 'Demo',
      description: '',
      endpoints: [],
      apiVersion: '1.0.0',
    });
  }
  const endpointIds: Types.ObjectId[] = [...(mockApi.endpoints as Types.ObjectId[])];

  for (const spec of endpoints) {
    const body: unknown = JSON.parse(spec.bodyJson);
    // Same shape the AI pipeline stores: the body is the example the mock engine answers with
    const response = new ResponseModel({
      statusCode: spec.statusCode,
      description: `${spec.method} ${spec.path} response`,
      schema: body ?? {},
      examples: [body ?? {}],
    });
    await response.save();
    createdResponseIds.push(response._id as Types.ObjectId);
    const endpoint = new EndpointModel({
      mockApiId: mockApi._id,
      path: spec.path,
      method: spec.method,
      description: `${spec.method} ${spec.path}`,
      requestSchema: {},
      responses: [response._id],
    });
    await endpoint.save();
    endpointIds.push(endpoint._id as Types.ObjectId);
    const headers = spec.headers && typeof spec.headers === 'object' ? spec.headers : {};
    if (Object.keys(headers).length > 0) {
      await EndpointConfigModel.create({ endpointId: endpoint._id, headers });
    }
  }
  mockApi.endpoints = endpointIds;
  await mockApi.save();
}

/** Puts a taken mock back as it was. Best effort: if even this fails the visitor can simply generate again. */
async function restore(demo: DemoMockDocument): Promise<void> {
  try {
    await DemoMockModel.replaceOne({ demoId: demo.demoId }, demo, { upsert: true });
  } catch (err) {
    console.error(
      `[Demo] could not restore a demo mock after a failed claim (${describeError(err)})`
    );
  }
}

/** Constant-time comparison of the SHA-256 of what the caller sent with the one stored (both 32 bytes, hex). */
function tokenMatches(claimToken: string, storedHash: string): boolean {
  const given = Buffer.from(hashClaimToken(claimToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
}

/** Removes a project made by a claim that has to be undone. If even that fails, archiving it stops it counting. */
async function discardProject(projectId: string): Promise<void> {
  try {
    await deleteProjectsCascade([projectId]);
  } catch (err) {
    console.error(
      `[Demo] could not remove the half-made project of a failed claim (${describeError(err)})`
    );
    await ProjectModel.updateOne({ _id: projectId }, { $set: { isArchived: true } }).catch(
      () => undefined
    );
  }
}

/**
 * Claims the demo `demoId` for `userId` if `claimToken` is its token. The caller has already checked the session and the
 * verified email. Throws AppError 404 when there is nothing to claim FOR THIS CALLER (no such demo, expired, already
 * claimed, token missing or wrong: all the same answer, and the demo stays untouched), 402 PLAN_LIMIT_REACHED when the
 * account is at its project limit (the demo is untouched or restored), 500 when the copy failed (the demo is restored).
 */
export async function claimDemoMock(
  userId: string,
  demoId: string,
  claimToken: unknown,
  now: Date
): Promise<ProjectDTO> {
  if (typeof claimToken !== 'string' || !isDemoId(demoId) || !isClaimToken(claimToken)) {
    throw notFound();
  }
  return withUserLock(userId, () => claimLocked(userId, demoId, claimToken, now));
}

async function claimLocked(
  userId: string,
  demoId: string,
  claimToken: string,
  now: Date
): Promise<ProjectDTO> {
  // Before touching the demo: a refusal for the plan leaves it exactly as it was
  const before = await getProjectLimitState(userId);
  if (before.reached) throw planLimitReached(before);

  const candidate = await DemoMockModel.findOne({ demoId, expiresAt: { $gt: now } })
    .select('claimTokenHash')
    .lean<Pick<DemoMockDocument, 'claimTokenHash'>>();
  if (!candidate || !tokenMatches(claimToken, candidate.claimTokenHash)) throw notFound();

  // Atomic take, bound to the hash that was just verified: whoever loses the race gets the 404
  const demo = await DemoMockModel.findOneAndDelete({
    demoId,
    claimTokenHash: candidate.claimTokenHash,
    expiresAt: { $gt: now },
  }).lean<DemoMockDocument>();
  if (!demo) throw notFound();

  let projectId: string | null = null;
  // A response saved just before its endpoint failed has no parent for the project cascade to find: remember them
  const createdResponseIds: Types.ObjectId[] = [];
  try {
    const project = await createProject(userId, { title: claimTitle(demo.endpoints) });
    projectId = project.id;
    await populate(project.id, demo.endpoints, createdResponseIds);
    // Another process may have created a project of this account since the check above: count again, and if the
    // account is over its limit undo this claim (the later of two racing claims always sees the other's project)
    const after = await getProjectLimitState(userId);
    if (Number.isFinite(after.limit) && after.active > after.limit) throw new OverLimit(after);
    return project;
  } catch (err) {
    if (projectId) await discardProject(projectId);
    await ResponseModel.deleteMany({ _id: { $in: createdResponseIds } }).catch(() => undefined);
    await restore(demo);
    if (err instanceof OverLimit) {
      throw planLimitReached({ ...err.state, active: err.state.active - 1 });
    }
    console.error(`[Demo] claim failed (${describeError(err)})`);
    throw new AppError(
      'The demo could not be saved as a project. Please try again.',
      ErrorCode.INTERNAL_SERVER_ERROR,
      500
    );
  }
}
