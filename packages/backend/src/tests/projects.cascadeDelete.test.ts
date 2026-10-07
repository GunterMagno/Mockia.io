import { Types } from 'mongoose';
import { NotificationType } from '@mockia/shared';
import { connectDB, disconnectDB } from '../config/connection.js';
import { ProjectModel } from '../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../models/MockAPI.js';
import { EndpointConfigModel } from '../models/EndpointConfig.js';
import { GitHubContextModel } from '../models/GitHubContext.js';
import { NotificationModel } from '../models/Notification.js';
import { cleanupArchivedProjects, hardDeleteProject } from '../modules/projects/service.js';
import { deleteProjectsCascade } from '../modules/projects/cascade.js';

// Privacidad y Terminos prometen que un proyecto eliminado se borra con TODO su contenido: sin huerfanos.
const ownerId = new Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

const COLLECTIONS = [
  ProjectModel,
  MockAPIModel,
  EndpointModel,
  ResponseModel,
  EndpointConfigModel,
  GitHubContextModel,
  NotificationModel,
] as const;

/** Un proyecto con un hijo en cada coleccion. */
async function seedProject(slug: string, opts: { archivedDaysAgo?: number } = {}) {
  const archived = opts.archivedDaysAgo !== undefined;
  const project = await ProjectModel.create({
    title: slug,
    description: 'x',
    slug,
    ownerId,
    members: [{ userId: ownerId, role: 'owner' as any, addedAt: new Date() }],
    apiKey: `key-${slug}`,
    isArchived: archived,
    archivedAt: archived ? new Date(Date.now() - opts.archivedDaysAgo! * DAY) : null,
  });
  const mockApi = await MockAPIModel.create({ projectId: project._id, title: slug });
  const response = await ResponseModel.create({ statusCode: 200, description: 'ok' });
  const endpoint = await EndpointModel.create({
    path: '/x',
    method: 'GET',
    description: 'x',
    responses: [response._id],
    mockApiId: mockApi._id,
  });
  await MockAPIModel.updateOne({ _id: mockApi._id }, { endpoints: [endpoint._id] });
  await EndpointConfigModel.create({ endpointId: endpoint._id, delay_ms: 10 });
  await GitHubContextModel.create({
    projectId: project._id,
    repoUrl: 'https://github.com/o/r',
    repoOwner: 'o',
    repoName: 'r',
    summary: 's',
    files: [],
    stats: { totalFiles: 0, totalInterfaces: 0, totalFunctions: 0, totalRoutes: 0 },
  });
  await NotificationModel.create({
    userId: ownerId,
    type: Object.values(NotificationType)[0],
    title: 't',
    message: 'm',
    projectId: project._id,
  });
  return project;
}

const counts = async () => Promise.all(COLLECTIONS.map((model) => (model as any).countDocuments({})));

describe('borrado en cascada de proyectos', () => {
  beforeAll(async () => {
    await connectDB();
  });
  afterAll(async () => {
    await disconnectDB();
  });
  beforeEach(async () => {
    await Promise.all(COLLECTIONS.map((model) => (model as any).deleteMany({})));
  });

  it('deleteProjectsCascade borra el proyecto y todos sus hijos sin tocar los de otros proyectos', async () => {
    const doomed = await seedProject('doomed');
    const kept = await seedProject('kept');

    const deleted = await deleteProjectsCascade([doomed._id.toString()]);

    expect(deleted).toBe(1);
    expect(await counts()).toEqual([1, 1, 1, 1, 1, 1, 1]); // solo queda el proyecto 'kept' con sus hijos
    expect(await ProjectModel.exists({ _id: kept._id })).toBeTruthy();
    expect(await MockAPIModel.countDocuments({ projectId: kept._id })).toBe(1);
    expect(await GitHubContextModel.countDocuments({ projectId: kept._id })).toBe(1);
    expect(await NotificationModel.countDocuments({ projectId: kept._id })).toBe(1);
    expect(await ProjectModel.exists({ _id: doomed._id })).toBeNull();
  });

  it('con una lista vacia no hace nada', async () => {
    await seedProject('a');
    expect(await deleteProjectsCascade([])).toBe(0);
    expect(await counts()).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('hardDeleteProject no deja huerfanos', async () => {
    const doomed = await seedProject('hard-doomed');
    const kept = await seedProject('hard-kept');

    await hardDeleteProject(doomed._id.toString(), ownerId.toString());

    expect(await counts()).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(await ProjectModel.exists({ _id: kept._id })).toBeTruthy();
  });

  it('cleanupArchivedProjects borra solo los archivados hace mas de 30 dias, con todos sus hijos', async () => {
    await seedProject('old-1', { archivedDaysAgo: 31 });
    await seedProject('old-2', { archivedDaysAgo: 90 });
    const recent = await seedProject('recent', { archivedDaysAgo: 5 });
    const active = await seedProject('active');

    expect(await cleanupArchivedProjects()).toBe(2);

    expect(await counts()).toEqual([2, 2, 2, 2, 2, 2, 2]); // 'recent' y 'active' completos
    expect(await MockAPIModel.countDocuments({ projectId: { $in: [recent._id, active._id] } })).toBe(2);
    expect(await ProjectModel.countDocuments({ slug: { $in: ['old-1', 'old-2'] } })).toBe(0);
  });
});
