import { ProjectModel, ProjectDocument } from '../../models/Project.js';
import { MockAPIModel, EndpointModel, EndpointDocument } from '../../models/MockAPI.js';
import { EndpointConfigModel, EndpointConfigDocument } from '../../models/EndpointConfig.js';

interface CacheEntry<T> {
  value: T;
  expiry: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private ttlMs: number;

  constructor(ttlMs = 15000) { // 15 seconds default TTL
    this.ttlMs = ttlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlOverride?: number): void {
    const ttl = ttlOverride !== undefined ? ttlOverride : this.ttlMs;

    // Evict if cache gets too large (e.g. 2000 items)
    if (this.cache.size >= 2000) {
      this.clearExpired();
      if (this.cache.size >= 2000) {
        // Force delete first key to keep size bound
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

class MockCacheService {
  private cache = new MemoryCache();

  /**
   * Resolves or gets project by its slug
   */
  async getProject(projectSlug: string): Promise<ProjectDocument | null> {
    const cacheKey = `project:${projectSlug}`;
    const cached = this.cache.get<ProjectDocument>(cacheKey);
    if (cached) return cached;

    let project;
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(projectSlug);
    if (isValidObjectId) {
      project = await ProjectModel.findById(projectSlug);
    }
    if (!project) {
      project = await ProjectModel.findOne({ slug: projectSlug });
    }

    if (project) {
      this.cache.set(cacheKey, project);
      this.cache.set(`project:id:${project._id.toString()}`, project);
    }
    return project;
  }

  /**
   * Resolves or gets mockAPI document for a project
   */
  async getMockAPI(projectId: string): Promise<any | null> {
    const cacheKey = `mockapi:${projectId}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const mockAPI = await MockAPIModel.findOne({ projectId });
    if (mockAPI) {
      this.cache.set(cacheKey, mockAPI);
    }
    return mockAPI;
  }

  /**
   * Gets and caches all endpoints of a project's MockAPI with populated responses
   */
  async getEndpoints(mockApiId: string): Promise<EndpointDocument[]> {
    const cacheKey = `endpoints:${mockApiId}`;
    const cached = this.cache.get<EndpointDocument[]>(cacheKey);
    if (cached) return cached;

    const query = EndpointModel.find({ mockApiId });
    const endpoints = typeof (query as any).populate === 'function'
      ? await (query as any).populate('responses')
      : await query;

    this.cache.set(cacheKey, endpoints);
    return endpoints;
  }

  /**
   * Gets and caches endpoint configuration
   */
  async getEndpointConfig(endpointId: string): Promise<EndpointConfigDocument | null> {
    const cacheKey = `config:${endpointId}`;
    const cached = this.cache.get<EndpointConfigDocument>(cacheKey);
    if (cached) return cached;

    const cfg = await EndpointConfigModel.findOne({ endpointId });
    if (cfg) {
      this.cache.set(cacheKey, cfg);
    }
    return cfg;
  }

  /**
   * Invalidates all cache entries for a given project slug
   */
  async invalidateProject(projectSlug: string): Promise<void> {
    const project = await this.getProject(projectSlug);
    this.cache.delete(`project:${projectSlug}`);
    if (project) {
      const projectIdStr = project._id.toString();
      this.cache.delete(`project:id:${projectIdStr}`);
      this.cache.delete(`mockapi:${projectIdStr}`);

      const mockAPI = await MockAPIModel.findOne({ projectId: project._id });
      if (mockAPI) {
        const mockApiIdStr = mockAPI._id.toString();
        this.cache.delete(`endpoints:${mockApiIdStr}`);

        // Also clear configs for this project's endpoints
        const endpoints = await EndpointModel.find({ mockApiId: mockAPI._id });
        for (const ep of endpoints) {
          this.cache.delete(`config:${ep._id.toString()}`);
        }
      }
    }
  }

  /**
   * Invalidates project cache by ID directly
   */
  async invalidateProjectId(projectId: string): Promise<void> {
    const idKey = `project:id:${projectId}`;
    const project = this.cache.get<ProjectDocument>(idKey);
    this.cache.delete(idKey);

    if (project) {
      this.cache.delete(`project:${project.slug}`);
      this.cache.delete(`mockapi:${projectId}`);
      const mockAPI = await MockAPIModel.findOne({ projectId });
      if (mockAPI) {
        const mockApiIdStr = mockAPI._id.toString();
        this.cache.delete(`endpoints:${mockApiIdStr}`);

        const endpoints = await EndpointModel.find({ mockApiId: mockAPI._id });
        for (const ep of endpoints) {
          this.cache.delete(`config:${ep._id.toString()}`);
        }
      }
    } else {
      // Fallback: fetch project to get the slug and perform cleanup
      const p = await ProjectModel.findById(projectId);
      if (p) {
        this.cache.delete(`project:${p.slug}`);
        this.cache.delete(`mockapi:${projectId}`);
        const mockAPI = await MockAPIModel.findOne({ projectId });
        if (mockAPI) {
          const mockApiIdStr = mockAPI._id.toString();
          this.cache.delete(`endpoints:${mockApiIdStr}`);

          const endpoints = await EndpointModel.find({ mockApiId: mockAPI._id });
          for (const ep of endpoints) {
            this.cache.delete(`config:${ep._id.toString()}`);
          }
        }
      }
    }
  }

  /**
   * Invalidates a specific endpoint configuration
   */
  invalidateEndpointConfig(endpointId: string): void {
    this.cache.delete(`config:${endpointId}`);
  }

  /**
   * Clears the entire cache
   */
  clearAll(): void {
    this.cache.clear();
  }
}

export const mockCache = new MockCacheService();
