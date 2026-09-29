/**
 * Guardia estructural para JSON/YAML no confiable (specs Swagger, salida de LLM): profundidad maxima,
 * numero maximo de nodos y ciclos (YAML permite `&a [*a]`, y JSON.stringify/BSON revientan con ellos).
 */

export const MAX_SCHEMA_DEPTH = 32;
export const MAX_SCHEMA_NODES = 200_000;

export type SchemaProblem = 'depth' | 'nodes' | 'cycle';

/**
 * Devuelve el primer problema encontrado o null. La recursion esta acotada por maxDepth, asi que no
 * puede desbordar la pila. Los nodos compartidos (alias YAML en forma de DAG) se visitan una sola vez:
 * evita la explosion exponencial de "billion laughs".
 * ponytail: un nodo compartido se mide a la profundidad de su primera visita; suficiente como tope.
 */
export function findSchemaProblem(
  root: unknown,
  maxDepth = MAX_SCHEMA_DEPTH,
  maxNodes = MAX_SCHEMA_NODES,
): SchemaProblem | null {
  const onPath = new Set<object>();
  const done = new Set<object>();
  let nodes = 0;

  const walk = (value: unknown, depth: number): SchemaProblem | null => {
    if (value === null || typeof value !== 'object') return null;
    if (depth > maxDepth) return 'depth';
    if (onPath.has(value)) return 'cycle';
    if (done.has(value)) return null;
    if (++nodes > maxNodes) return 'nodes';
    onPath.add(value);
    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const child of children) {
      const problem = walk(child, depth + 1);
      if (problem) return problem;
    }
    onPath.delete(value);
    done.add(value);
    return null;
  };

  return walk(root, 0);
}
