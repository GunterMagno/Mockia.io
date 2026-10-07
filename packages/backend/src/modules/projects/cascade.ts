import { Types } from 'mongoose';
import { ProjectModel } from '../../models/Project.js';
import { EndpointModel, MockAPIModel, ResponseModel } from '../../models/MockAPI.js';
import { EndpointConfigModel } from '../../models/EndpointConfig.js';
import { GitHubContextModel } from '../../models/GitHubContext.js';
import { NotificationModel } from '../../models/Notification.js';

/**
 * Permanently deletes projects TOGETHER WITH everything that hangs from them, so nothing is left orphaned.
 * The Privacy Policy promises exactly this ("deleted projects are erased"), so every hard-delete path must go through it
 * (hardDeleteProject, the 30-day archive cleanup and, later, account deletion).
 *
 * Children, from the leaves up: Response -> EndpointConfig -> Endpoint -> MockAPI (projectId) -> GitHubContext (projectId)
 * -> Notification (projectId) -> Project. If a new model references a project or one of these, add it here and to
 * tests/projects.cascadeDelete.test.ts.
 *
 * MongoDB has no cross-collection transaction here: children go first and the project last, so a failure midway leaves
 * the project in place and the call can simply be retried (deleting is idempotent).
 *
 * @param projectIds - ids of the projects to delete (strings or ObjectIds); unknown ids are ignored
 * @returns number of projects deleted
 */
export async function deleteProjectsCascade(projectIds: Array<string | Types.ObjectId>): Promise<number> {
  if (projectIds.length === 0) return 0;
  const ids = projectIds.map((id) => new Types.ObjectId(id));

  const mockApiIds = (await MockAPIModel.find({ projectId: { $in: ids } }).select('_id').lean()).map((m) => m._id);
  const endpoints = await EndpointModel.find({ mockApiId: { $in: mockApiIds } })
    .select('_id responses')
    .lean();
  const endpointIds = endpoints.map((e) => e._id);
  const responseIds = endpoints.flatMap((e) => e.responses ?? []);

  await ResponseModel.deleteMany({ _id: { $in: responseIds } });
  await EndpointConfigModel.deleteMany({ endpointId: { $in: endpointIds } });
  await EndpointModel.deleteMany({ mockApiId: { $in: mockApiIds } });
  await MockAPIModel.deleteMany({ projectId: { $in: ids } });
  await GitHubContextModel.deleteMany({ projectId: { $in: ids } });
  await NotificationModel.deleteMany({ projectId: { $in: ids } });

  const result = await ProjectModel.deleteMany({ _id: { $in: ids } });
  return result.deletedCount ?? 0;
}
