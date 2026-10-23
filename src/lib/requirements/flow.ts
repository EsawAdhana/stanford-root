/**
 * Min-cost flow, used to assign courses to requirements.
 *
 * Every edge carries a cost; a requirement that wants a course is a negative
 * cost (a reward). Successive shortest paths keep augmenting while a path
 * still lowers the total cost, so the result is the assignment with the most
 * reward, not merely the most courses placed. That is the difference from
 * filling requirements in order: a course carrying two Ways lands in the Way
 * nothing else can fill, which is the case My Academic Path gets wrong.
 *
 * The graph starts as a DAG (source -> course -> program -> slot -> sink), so
 * the residual graph never has a negative cycle and Bellman-Ford (SPFA) is
 * safe. Graphs here are a few hundred nodes.
 *
 * Adjacency lists are walked in insertion order, so the same input always
 * gives the same answer and the screen does not flicker between ties.
 */
export class MinCostFlow {
  private adj: number[][] = []
  private to: number[] = []
  private cap: number[] = []
  private cost: number[] = []

  addNode(): number {
    this.adj.push([])
    return this.adj.length - 1
  }

  /** Returns the edge id, whose flow `flowOn` reads after `run`. */
  addEdge(from: number, toNode: number, capacity: number, cost: number): number {
    const id = this.to.length
    this.to.push(toNode, from)
    this.cap.push(capacity, 0)
    this.cost.push(cost, -cost)
    this.adj[from].push(id)
    this.adj[toNode].push(id + 1)
    return id
  }

  /** Flow on an edge returned by addEdge: what its reverse edge holds. */
  flowOn(edge: number): number {
    return this.cap[edge ^ 1]
  }

  run(source: number, sink: number): { flow: number; cost: number } {
    let flow = 0
    let total = 0
    const n = this.adj.length
    for (;;) {
      const dist = new Array<number>(n).fill(Infinity)
      const inQueue = new Array<boolean>(n).fill(false)
      const via = new Array<number>(n).fill(-1)
      dist[source] = 0
      const queue: number[] = [source]
      let head = 0
      inQueue[source] = true
      while (head < queue.length) {
        const u = queue[head++]
        inQueue[u] = false
        for (const e of this.adj[u]) {
          if (this.cap[e] <= 0) continue
          const v = this.to[e]
          const d = dist[u] + this.cost[e]
          if (d < dist[v]) {
            dist[v] = d
            via[v] = e
            if (!inQueue[v]) {
              inQueue[v] = true
              queue.push(v)
            }
          }
        }
      }
      // Stop once no path lowers the cost: more flow would place a course
      // where it is worth nothing, or undo a better placement.
      if (dist[sink] === Infinity || dist[sink] >= 0) break
      let push = Infinity
      for (let v = sink; v !== source; v = this.to[via[v] ^ 1]) push = Math.min(push, this.cap[via[v]])
      for (let v = sink; v !== source; v = this.to[via[v] ^ 1]) {
        this.cap[via[v]] -= push
        this.cap[via[v] ^ 1] += push
      }
      flow += push
      total += push * dist[sink]
    }
    return { flow, cost: total }
  }
}
