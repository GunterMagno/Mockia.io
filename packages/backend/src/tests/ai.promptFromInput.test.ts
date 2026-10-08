import { buildPrompt, buildPromptFromInput, type PromptInput } from '../modules/ai/prompt.service.js';
import { ProjectModel } from '../models/Project.js';
import { getProjectContext } from '../services/github-context.service.js';

jest.mock('../models/Project');
jest.mock('../services/github-context.service');

/**
 * buildPromptFromInput is the pure seam of buildPrompt: the same messages from plain data, with no database. The eval
 * bench uses it so a model is judged on the prompt the product really sends.
 */

const CONTEXT = {
  repoName: 'gym-api',
  repoUrl: 'https://github.com/acme/gym-api',
  repoOwner: 'acme',
  branch: 'main',
  summary: 'Gym members API',
  stats: { totalFiles: 2, totalInterfaces: 1, totalFunctions: 0, totalRoutes: 1 },
  files: [
    { path: 'README.md', type: 'other', summary: '# Gym API\nManages members.' },
    {
      path: 'src/routes/members.ts',
      type: 'typescript',
      summary: 'Members router',
      routes: [{ methods: ['GET'], path: '/members' }],
      interfaces: [{ name: 'Member', properties: ['id: string', 'name: string'] }],
    },
  ],
};

describe('buildPromptFromInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds system + context + task messages from plain data', () => {
    const input: PromptInput = { projectTitle: 'Gym', projectDescription: 'Gym app', userInput: 'members CRUD', context: CONTEXT };
    const messages = buildPromptFromInput(input);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(messages[1].content).toContain('## Repository: gym-api');
    expect(messages[1].content).toContain('interface Member { id: string; name: string }');
    expect(messages[1].content).toContain('[Project Documentation / README] README.md');
    expect(messages[2].content).toContain('members CRUD');
    expect(messages[2].content).toContain('README');
  });

  it('without context it uses the creative-freedom prompt with the project title and description', () => {
    const messages = buildPromptFromInput({ projectTitle: 'Task Tracker', projectDescription: 'Track tasks', userInput: 'full API', context: null });
    expect(messages[1].content).toContain('## Project: Task Tracker');
    expect(messages[1].content).toContain('No GitHub context available yet.');
    expect(messages[2].content).toContain('MAXIMUM CREATIVE FREEDOM');
    expect(messages[2].content).toContain('Task Tracker');
    expect(messages[2].content).toContain('Track tasks');
  });

  it('an empty context object counts as no context, like buildPrompt', () => {
    const messages = buildPromptFromInput({ projectTitle: 'P', userInput: 'x', context: {} });
    expect(messages[2].content).toContain('MAXIMUM CREATIVE FREEDOM');
    expect(messages[1].content).toContain('A software application');
  });

  it('honours includeSystemPrompt and contextBudgetOverride', () => {
    const none = buildPromptFromInput({ projectTitle: 'P', userInput: 'x', context: CONTEXT, options: { includeSystemPrompt: false } });
    expect(none.map((m) => m.role)).toEqual(['user', 'user']);
    const tiny = buildPromptFromInput({ projectTitle: 'P', userInput: 'x', context: CONTEXT, options: { contextBudgetOverride: 20 } });
    expect(tiny[1].content).toContain('[Context truncated due to length]');
  });

  it('does not touch the database or the context service', () => {
    buildPromptFromInput({ projectTitle: 'P', userInput: 'x', context: CONTEXT });
    expect(ProjectModel.findById).not.toHaveBeenCalled();
    expect(getProjectContext).not.toHaveBeenCalled();
  });

  it('buildPrompt returns exactly what buildPromptFromInput returns for the same project and context', async () => {
    (ProjectModel.findById as jest.Mock).mockResolvedValue({ _id: '123456789012345678901234', title: 'Gym', description: 'Gym app' });
    (getProjectContext as jest.Mock).mockResolvedValue(CONTEXT);
    const viaDb = await buildPrompt('123456789012345678901234', 'members CRUD');
    expect(viaDb).toEqual(
      buildPromptFromInput({ projectTitle: 'Gym', projectDescription: 'Gym app', userInput: 'members CRUD', context: CONTEXT })
    );

    (getProjectContext as jest.Mock).mockRejectedValue(new Error('no context'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const noContext = await buildPrompt('123456789012345678901234', 'members CRUD');
    expect(noContext).toEqual(
      buildPromptFromInput({ projectTitle: 'Gym', projectDescription: 'Gym app', userInput: 'members CRUD', context: null })
    );
  });
});
