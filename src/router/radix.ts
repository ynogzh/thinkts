import type { RouteEntry } from "./handler";

/** A node in the radix tree. Each node represents one URL segment. */
interface RadixNode {
  /** Static children: segment → node */
  static: Map<string, RadixNode>;
  /** Optional wildcard child (e.g. `:id`) */
  param?: { name: string; node: RadixNode };
  /** Handler if this node is a terminal route */
  handler?: RouteEntry;
}

/**
 * Radix tree router — O(k) matching where k = number of URL segments.
 * Replaces the O(n) linear scan of regex patterns for parameterized routes.
 */
export class RadixTree {
  private root: RadixNode = { static: new Map() };

  /** Insert a route pattern. Supports `:param` segments. */
  insert(path: string, entry: RouteEntry): void {
    const segments = path.split("/").filter(Boolean);
    let node = this.root;

    for (const seg of segments) {
      if (seg.startsWith(":")) {
        const paramName = seg.slice(1);
        if (!node.param) {
          node.param = { name: paramName, node: { static: new Map() } };
        }
        node = node.param.node;
      } else {
        let child = node.static.get(seg);
        if (!child) {
          child = { static: new Map() };
          node.static.set(seg, child);
        }
        node = child;
      }
    }
    node.handler = entry;
  }

  /** Match a path against the tree. Returns handler + extracted params. */
  match(pathname: string): { entry: RouteEntry; params?: Record<string, string> } | undefined {
    const segments = pathname.split("/").filter(Boolean);
    let node = this.root;
    const params: Record<string, string> = {};

    for (const seg of segments) {
      const staticChild = node.static.get(seg);
      if (staticChild) {
        node = staticChild;
        continue;
      }
      if (node.param) {
        params[node.param.name] = seg;
        node = node.param.node;
        continue;
      }
      return undefined;
    }

    if (!node.handler) return undefined;
    return { entry: node.handler, params: Object.keys(params).length > 0 ? params : undefined };
  }

  /** Number of nodes in the tree (for testing/debugging). */
  get size(): number {
    return this.countNodes(this.root);
  }

  private countNodes(node: RadixNode): number {
    let count = 1;
    for (const child of node.static.values()) count += this.countNodes(child);
    if (node.param) count += this.countNodes(node.param.node);
    return count;
  }
}
