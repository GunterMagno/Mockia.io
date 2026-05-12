/**
 * GitHub Context Types
 * Types related to GitHub repository context and analysis
 */

export interface FileInfo {
  path: string;
  type: 'typescript' | 'swagger' | 'other';
  interfaces?: Array<{ name: string; properties: string[] }>;
  functions?: Array<{ name: string; params: string[]; returnType?: string }>;
  enums?: Array<{ name: string; members: string[] }>;
  typeAliases?: Array<{ name: string; type: string }>;
  routes?: Array<{ path: string; methods: string[] }>;
  summary?: string;
}

export interface GitHubContextStats {
  totalFiles: number;
  totalInterfaces: number;
  totalFunctions: number;
  totalRoutes: number;
}

export interface GitHubContext {
  id: string;
  projectId: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  branch?: string;
  summary: string;
  files: FileInfo[];
  stats: GitHubContextStats;
  createdAt: string;
  updatedAt: string;
}
