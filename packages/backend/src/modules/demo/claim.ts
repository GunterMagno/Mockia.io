import { Types } from 'mongoose';
import { ErrorCode } from '@mockia/shared';
import type { Project as ProjectDTO } from '@mockia/shared';
import { AppError } from '../../middlewares/errorHandler.js';
import { DemoMockModel, type DemoEndpointDocument, type DemoMockDocument } from '../../models/DemoMock.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../../models/MockAPI.js';
import { describeError } from '../../utils/safeErrorLog.js';
import { deleteProjectsCascade } from '../projects/cascade.js';
import { createProject } from '../projects/service.js';
import { isDemoId } from './mockStore.js';

/**
 * Turning a visitor's ephemeral demo mock into a real project of their account (task B6).
 *
 * The demo id is a 128-bit capability: whoever holds it may claim it, and nothing lists demos. The claim is ATOMIC: the
 * mock is taken with one findOneAndDelete, so however many requests race for the same id at most one gets it (and
 * creates at most one project). If creating the project then fails the mock is put back exactly as it was (same id,
 * same expiry and request count), so a plan-limit refusal or a database hiccup never costs the visitor their demo.
 * The claim spends no AI quota and no demo budget: it copies what the demo already produced.
 */

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
  const clean = (segment ?? '').replace(/[^A-Za-z0-9._~@-]/g, '').slice(0, CLAIM_TITLE_MAX - 'Demo - '.length);
  return clean ? `Demo - ${clean}` : 'Demo';
}

/** Writes the demo's endpoints under the project's MockAPI exactly like the AI pipeline does (Endpoint -> Response). */
async function populate(projectId: string, endpoints: DemoEndpointDocument[], createdResponseIds: Types.ObjectId[]): Promise<void> {
  const projectObjectId = new Types.ObjectId(projectId);
  // createProject makes it, but tolerates a failure of that secondary document
  let mockApi = await MockAPIModel.findOne({ projectId: projectObjectId });
  if (!mockApi) {
    mockApi = await MockAPIModel.create({ projectId: projectObjectId, title: 'Demo', description: '', endpoints: [], apiVersion: '1.0.0' });
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
    console.error(`[Demo] could not restore a demo mock after a failed claim (${describeError(err)})`);
  }
}

/**
 * Claims `demoId` for `userId`. The caller has already checked the session, the verified email and the plan's
 * project limit. Throws AppError 404 when there is nothing to claim, 500 when the copy failed (the demo is restored).
 */
export async function claimDemoMock(userId: string, demoId: string, now: Date): Promise<ProjectDTO> {
  if (!isDemoId(demoId)) throw notFound();

  const demo = await DemoMockModel.findOneAndDelete({ demoId, expiresAt: { $gt: now } }).lean<DemoMockDocument>();
  if (!demo) throw notFound();

  let projectId: string | null = null;
  // A response saved just before its endpoint failed has no parent for the project cascade to find: remember them
  const createdResponseIds: Types.ObjectId[] = [];
  try {
    const project = await createProject(userId, { title: claimTitle(demo.endpoints) });
    projectId = project.id;
    await populate(project.id, demo.endpoints, createdResponseIds);
    return project;
  } catch (err) {
    if (projectId) {
      await deleteProjectsCascade([projectId]).catch((cleanupErr: unknown) =>
        console.error(`[Demo] could not remove the half-made project of a failed claim (${describeError(cleanupErr)})`),
      );
    }
    await ResponseModel.deleteMany({ _id: { $in: createdResponseIds } }).catch(() => undefined);
    await restore(demo);
    console.error(`[Demo] claim failed (${describeError(err)})`);
    throw new AppError('The demo could not be saved as a project. Please try again.', ErrorCode.INTERNAL_SERVER_ERROR, 500);
  }
}
