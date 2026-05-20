import { parseGitHubUrl, cloneRepository, codeAnalyzer, cleanupRepository } from '../services/github.service.js';
import fs from 'fs/promises';
import path from 'path';

function extractRoutesFromFileContent(content: string): Array<{ path: string; methods: string[] }> {
  const routes: Array<{ path: string; methods: string[] }> = [];
  
  // 1. Find explicit HTTP method calls on axios/fetch/router/app:
  // e.g. axios.get('/api/users') or router.post('/login')
  const apiCallRegex = /(?:axios|fetch|client|api|router|app)\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`\s\?]+)['"`]/gi;
  let match;
  const foundMap = new Map<string, Set<string>>();

  while ((match = apiCallRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];
    
    // Normalize path by replacing dynamic IDs (e.g., /menu/1 or /menu/:id) to a standard path template
    const normalizedPath = path.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/:\w+/g, '/{id}');
    
    if (!foundMap.has(normalizedPath)) {
      foundMap.set(normalizedPath, new Set());
    }
    foundMap.get(normalizedPath)!.add(method);
  }

  // 2. Also search for raw path strings like "/menu/1", "/reservations", etc.
  const pathRegex = /['"`](\/[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-:{}/]+)+)['"`]/g;
  while ((match = pathRegex.exec(content)) !== null) {
    const path = match[1];
    // Ignore common non-paths like URLs, image sources, or long paths
    if (path.includes('.') || path.length > 50) continue;
    
    const normalizedPath = path.replace(/\/\d+(?=\/|$)/g, '/{id}').replace(/\/:\w+/g, '/{id}');
    if (!foundMap.has(normalizedPath)) {
      // By default, if we find a path like /menu/1, associate it with GET
      foundMap.set(normalizedPath, new Set(['GET']));
    }
  }

  // Convert map to array
  for (const [p, methods] of foundMap.entries()) {
    routes.push({
      path: p,
      methods: Array.from(methods),
    });
  }

  return routes;
}

async function run() {
  let repoPath: string | null = null;
  try {
    const url = 'https://github.com/GunterMagno/PruebaMockia/tree/main';
    console.log('Parsing URL:', url);
    const parsed = parseGitHubUrl(url);
    
    console.log('Cloning...');
    repoPath = await cloneRepository(parsed.owner, parsed.repo, parsed.branch);
    console.log('Cloned successfully at:', repoPath);

    const playgroundPath = path.join(repoPath, 'src/components/scanner/RequestPlayground.jsx');
    const content = await fs.readFile(playgroundPath, 'utf-8');

    const routes = extractRoutesFromFileContent(content);
    console.log('Extracted routes from RequestPlayground.jsx:');
    console.log(JSON.stringify(routes, null, 2));

  } catch (err) {
    console.error('Error occurred:', err);
  } finally {
    if (repoPath) {
      await cleanupRepository(repoPath);
    }
  }
}

run();
