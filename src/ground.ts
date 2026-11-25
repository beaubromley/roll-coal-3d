import { Scene, Mesh, VertexData, VertexBuffer, Material } from "@babylonjs/core";

/**
 * The whole open ground as a diggable height field, in two levels of detail.
 *  - far: 128 m tiles on a 4 m grid, covering everything out to the cliffs (tiles get "holes" wherever a near chunk is drawn, and under the pad)
 *  - near: 32 m chunks on a 1 m grid, streamed in around the player; these are what you dig
 * Heights are base terrain (hills, mesas, the pond basin) plus a sparse map of edits made by the backhoe, on a 1 m vertex grid.
 */
const FAR = 128, FAR_N = 32, NEAR = 32, NEAR_N = 32, HALF = 704, SK = 3;
type Base = (x: number, z: number) => number;
interface Tile { mesh: Mesh; x0: number; z0: number; step: number; n: number; mask: Uint8Array | null; h: Float32Array; dirty: boolean; ntris: number }
interface Chunk { mesh: Mesh; cx: number; cz: number; h: Float32Array; active: boolean; dirty: boolean; lo: number; hi: number; loZ: number; hiZ: number; full: boolean }

const key = (a: number, b: number) => (a + 4096) * 8192 + (b + 4096);
const smooth = (k: number) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

export class Ground {
  private edits = new Map<number, number>();
  private editedChunks = new Set<number>();
  private tiles: Tile[] = [];
  private tileMap = new Map<number, Tile>();
  private chunks = new Map<number, Chunk>();
  private pool: Chunk[] = [];
  private focusT = 0; private rebuildT = 0;
  private dirtyChunks = new Set<Chunk>(); private dirtyTiles = new Set<Tile>(); private maskDirty = new Set<Tile>();
  /** areas with no ground drawn: under the pad (it has its own mesh) */
  private skip: (x: number, z: number) => boolean;

  constructor(private scene: Scene, private base: Base, private mat: Material | null, skip: (x: number, z: number) => boolean) {
    this.skip = skip;
    for (let tz = -HALF; tz < HALF; tz += FAR) for (let tx = -HALF; tx < HALF; tx += FAR) {
      if (Math.hypot(Math.max(Math.abs(tx), Math.abs(tx + FAR)), Math.max(Math.abs(tz), Math.abs(tz + FAR))) > 1000) continue;
      const t = this.makeTile(tx, tz); this.tiles.push(t); this.tileMap.set(key(tx / FAR, tz / FAR), t);
    }
  }

  // ------------------------------------------------------------------------------------------ heights
  /** the edit (dig positive/negative) at a point: bilinear between 1 m vertices */
  delta(x: number, z: number): number {
    if (!this.editedChunks.size) return 0;
    if (!this.editedChunks.has(key(Math.floor(x / NEAR), Math.floor(z / NEAR)))) return 0;
    const i = Math.floor(x), j = Math.floor(z), fu = x - i, fv = z - j, e = this.edits;
    const a = e.get(key(i, j)) ?? 0, b = e.get(key(i + 1, j)) ?? 0, c = e.get(key(i, j + 1)) ?? 0, d = e.get(key(i + 1, j + 1)) ?? 0;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
  height(x: number, z: number) { return this.base(x, z) + this.delta(x, z); }
  /** how much dirt is missing/added at a vertex */
  private vdelta(i: number, j: number) { return this.edits.get(key(i, j)) ?? 0; }

  /** scrape the ground down to ty round (tx, tz); returns the volume removed (m3, roughly) */
  dig(tx: number, ty: number, tz: number, dt: number, allow: (x: number, z: number) => boolean): number {
    const R = 1.5; let removed = 0;
    for (let j = Math.floor(tz - R); j <= Math.ceil(tz + R); j++) for (let i = Math.floor(tx - R); i <= Math.ceil(tx + R); i++) {
      const d = Math.hypot(i - tx, j - tz); if (d > R || !allow(i, j)) continue;
      const base = this.base(i, j), cur = base + this.vdelta(i, j), target = Math.max(base - 4.2, ty - 0.1);
      if (cur > target) { const dl = Math.min(cur - target, 5 * dt * (1 - d / R)); this.setV(i, j, this.vdelta(i, j) - dl); removed += dl; }
    }
    return removed;
  }
  /** dump a bucketful as a mound round (tx, tz) */
  pile(tx: number, tz: number, amt: number, allow: (x: number, z: number) => boolean) {
    const R = 1.9, cells: [number, number, number][] = []; let sum = 0;
    for (let j = Math.floor(tz - R); j <= Math.ceil(tz + R); j++) for (let i = Math.floor(tx - R); i <= Math.ceil(tx + R); i++) {
      const d = Math.hypot(i - tx, j - tz); if (d > R || !allow(i, j)) continue; const w = 1 - d / R; cells.push([i, j, w]); sum += w;
    }
    if (!sum) return;
    for (const [i, j, w] of cells) this.setV(i, j, Math.min(4.2, this.vdelta(i, j) + (amt * w) / sum));
  }
  private setV(i: number, j: number, v: number) {
    if (Math.abs(v) < 1e-4) this.edits.delete(key(i, j)); else this.edits.set(key(i, j), v);
    // a vertex on a chunk border belongs to up to four chunks
    for (const a of [i - 1, i]) for (const b of [j - 1, j]) {
      const ck = key(Math.floor(a / NEAR), Math.floor(b / NEAR)); this.editedChunks.add(ck);
      const ch = this.chunks.get(ck); if (ch && ch.active) { this.markChunk(ch, i, j); }
    }
  }
  private markChunk(ch: Chunk, i: number, j: number) {
    const li = i - ch.cx * NEAR, lj = j - ch.cz * NEAR;
    ch.lo = Math.min(ch.lo, li); ch.hi = Math.max(ch.hi, li); ch.loZ = Math.min(ch.loZ, lj); ch.hiZ = Math.max(ch.hiZ, lj); ch.dirty = true; this.dirtyChunks.add(ch);
  }
  private tileAt(x: number, z: number): Tile | undefined { return this.tileMap.get(key(Math.floor(x / FAR), Math.floor(z / FAR))); }

  // ------------------------------------------------------------------------------------------ meshes
  private colorAt(h: number): [number, number, number] {
    const k = h < 0 ? smooth(-h / 2.6) : 0, l = h > 0.3 ? Math.min(1, h / 8) * 0.0 : 0;   // darker soil where it is deep
    return [1 - k * 0.7 + l, 1 - k * 0.72 + l, 1 - k * 0.7 + l];
  }
  /** fill a (n+1)x(n+1) grid mesh (with a skirt) from a height array of (n+3)x(n+3) samples (one extra ring for the normals) */
  private fill(m: Mesh, x0: number, z0: number, step: number, n: number, h: Float32Array, cols: Float32Array | null, rect?: [number, number, number, number]) {
    const W = n + 3, V = n + 1, pos = (m.getVerticesData(VertexBuffer.PositionKind) as Float32Array), nrm = (m.getVerticesData(VertexBuffer.NormalKind) as Float32Array), col = (m.getVerticesData(VertexBuffer.ColorKind) as Float32Array);
    const i0 = rect ? rect[0] : 0, i1 = rect ? rect[1] : n, j0 = rect ? rect[2] : 0, j1 = rect ? rect[3] : n;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * V + i, hh = h[(j + 1) * W + i + 1];
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = hh; pos[k * 3 + 2] = z0 + j * step;
      const gx = (h[(j + 1) * W + i + 2] - h[(j + 1) * W + i]) / (2 * step), gz = (h[(j + 2) * W + i + 1] - h[j * W + i + 1]) / (2 * step), il = 1 / Math.hypot(gx, 1, gz);
      nrm[k * 3] = -gx * il; nrm[k * 3 + 1] = il; nrm[k * 3 + 2] = -gz * il;
      const c = this.colorAt(hh); col[k * 4] = c[0]; col[k * 4 + 1] = c[1]; col[k * 4 + 2] = c[2]; col[k * 4 + 3] = 1;
    }
    // skirts: the outer ring duplicated and dropped, so cracks between the two levels of detail never show daylight
    const sk0 = V * V;
    const edge: [number, number][] = []; for (let i = 0; i <= n; i++) edge.push([i, 0]); for (let j = 1; j <= n; j++) edge.push([n, j]); for (let i = n - 1; i >= 0; i--) edge.push([i, n]); for (let j = n - 1; j >= 1; j--) edge.push([0, j]);
    edge.forEach(([i, j], e) => { const k = j * V + i, s = sk0 + e; pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - SK; pos[s * 3 + 2] = pos[k * 3 + 2]; nrm[s * 3] = nrm[k * 3]; nrm[s * 3 + 1] = nrm[k * 3 + 1]; nrm[s * 3 + 2] = nrm[k * 3 + 2]; col[s * 4] = col[k * 4]; col[s * 4 + 1] = col[k * 4 + 1]; col[s * 4 + 2] = col[k * 4 + 2]; col[s * 4 + 3] = 1; });
    m.updateVerticesData(VertexBuffer.PositionKind, pos); m.updateVerticesData(VertexBuffer.NormalKind, nrm); m.updateVerticesData(VertexBuffer.ColorKind, col);
    m.refreshBoundingInfo();
    void cols;
  }
  private heights(x0: number, z0: number, step: number, n: number, out: Float32Array) {
    const W = n + 3; for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) out[(j + 1) * W + i + 1] = this.height(x0 + i * step, z0 + j * step);
  }
  private newMesh(name: string, n: number): Mesh {
    const V = n + 1, count = V * V + 4 * n, m = new Mesh(name, this.scene);
    const uvs = new Float32Array(count * 2), vd = new VertexData();
    vd.positions = new Float32Array(count * 3); vd.normals = new Float32Array(count * 3); vd.colors = new Float32Array(count * 4).fill(1); vd.uvs = uvs;
    // two triangles per cell, then the skirt quads
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * V + i, b = a + 1, c = a + V, d = c + 1; idx.push(a, c, b, b, c, d); }
    for (let e = 0; e < 4 * n; e++) { const k = e, k2 = (e + 1) % (4 * n); const eIdx = (q: number) => { const s = q; if (s <= n) return s; if (s <= 2 * n) return (s - n) * V + n; if (s <= 3 * n) return n * V + (3 * n - s); return (4 * n - s) * V; }; const a = eIdx(k), b = eIdx(k2), sa = V * V + k, sb = V * V + k2; idx.push(a, sa, b, b, sa, sb); }
    vd.indices = idx; vd.applyToMesh(m, true);
    if (this.mat) m.material = this.mat; m.receiveShadows = false; m.isPickable = false; m.alwaysSelectAsActiveMesh = false;
    return m;
  }
  private setUV(m: Mesh, x0: number, z0: number, step: number, n: number) {
    const V = n + 1, uv = new Float32Array((V * V + 4 * n) * 2), pos = m.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
    for (let k = 0; k < V * V + 4 * n; k++) { uv[k * 2] = (pos[k * 3] + 3000) / 6000; uv[k * 2 + 1] = (pos[k * 3 + 2] + 3000) / 6000; }
    m.updateVerticesData(VertexBuffer.UVKind, uv); void x0; void z0; void step;
  }

  private makeTile(x0: number, z0: number): Tile {
    const n = FAR_N, step = FAR / FAR_N, h = new Float32Array((n + 3) * (n + 3)), m = this.newMesh("groundfar", n);
    this.heights(x0, z0, step, n, h); this.fill(m, x0, z0, step, n, h, null); this.setUV(m, x0, z0, step, n);
    const t: Tile = { mesh: m, x0, z0, step, n, mask: new Uint8Array(n * n), h, dirty: true, ntris: 0 };
    this.applyMask(t); return t;
  }
  private applyMask(t: Tile) {
    const n = t.n, V = n + 1, mask = t.mask!, idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = t.x0 + (i + 0.5) * t.step, cz = t.z0 + (j + 0.5) * t.step;
      if (mask[j * n + i] || this.skip(cx, cz)) continue;
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1; idx.push(a, c, b, b, c, d);
    }
    for (let e = 0; e < 4 * n; e++) { const k = e, k2 = (e + 1) % (4 * n); const eIdx = (q: number) => { if (q <= n) return q; if (q <= 2 * n) return (q - n) * V + n; if (q <= 3 * n) return n * V + (3 * n - q); return (4 * n - q) * V; }; const a = eIdx(k), b = eIdx(k2), sa = V * V + k, sb = V * V + k2; idx.push(a, sa, b, b, sa, sb); }
    t.mesh.setIndices(idx, undefined, true); t.ntris = idx.length / 3; t.mesh.setEnabled(idx.length > 4 * n * 6);
  }

  // ------------------------------------------------------------------------------------------ streaming
  /** call every frame with the places that need fine detail (the player, and a point ahead of a fast vehicle) */
  update(dt: number, focus: { x: number; z: number }[]) {
    this.focusT -= dt;
    if (this.focusT <= 0) { this.focusT = 0.2; this.stream(focus, 3); }
    let n = 0; for (const t of this.maskDirty) { this.applyMask(t); this.maskDirty.delete(t); if (++n >= 3) break; }
    // redraw whatever was dug (throttled)
    this.rebuildT -= dt;
    if (this.rebuildT <= 0 && (this.dirtyChunks.size || this.dirtyTiles.size)) {
      this.rebuildT = 0.1;
      for (const ch of this.dirtyChunks) this.refreshChunk(ch);
      this.dirtyChunks.clear();
      for (const t of this.dirtyTiles) { this.heights(t.x0, t.z0, t.step, t.n, t.h); this.fill(t.mesh, t.x0, t.z0, t.step, t.n, t.h, null); }
      this.dirtyTiles.clear();
    }
  }

  /** build everything round the focus straight away (at start-up, or after a teleport) */
  prime(focus: { x: number; z: number }[]) { this.stream(focus, 999); for (const t of this.maskDirty) this.applyMask(t); this.maskDirty.clear(); }
  private maskChunk(cx: number, cz: number, v: number) {
    const t = this.tileAt((cx + 0.5) * NEAR, (cz + 0.5) * NEAR); if (!t || !t.mask) return;
    const i0 = Math.round((cx * NEAR - t.x0) / t.step), j0 = Math.round((cz * NEAR - t.z0) / t.step), cells = Math.round(NEAR / t.step);
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) { const k = (j0 + j) * t.n + i0 + i; if (k >= 0 && k < t.mask.length) t.mask[k] = v; }
    this.maskDirty.add(t);
  }
  private stream(focus: { x: number; z: number }[], maxBuild: number) {
    const R = 112, want = new Map<number, [number, number]>();
    for (const f of focus) {
      for (let cz = Math.floor((f.z - R) / NEAR); cz <= Math.floor((f.z + R) / NEAR); cz++) for (let cx = Math.floor((f.x - R) / NEAR); cx <= Math.floor((f.x + R) / NEAR); cx++) {
        const mx = (cx + 0.5) * NEAR, mz = (cz + 0.5) * NEAR; if (Math.hypot(mx - f.x, mz - f.z) > R) continue;
        if (Math.abs(mx) > HALF || Math.abs(mz) > HALF) continue;
        // chunks wholly inside the pad are never needed
        if (this.skip(cx * NEAR, cz * NEAR) && this.skip(cx * NEAR + NEAR, cz * NEAR) && this.skip(cx * NEAR, cz * NEAR + NEAR) && this.skip(cx * NEAR + NEAR, cz * NEAR + NEAR)) continue;
        want.set(key(cx, cz), [cx, cz]);
      }
    }
    // release chunks nobody wants any more
    for (const [k, ch] of this.chunks) if (!want.has(k)) { this.release(ch); this.chunks.delete(k); }
    // build at most two new ones per pass (nearest first would be nicer, but order of discovery is fine)
    let built = 0;
    for (const [k, [cx, cz]] of want) { if (this.chunks.has(k)) continue; if (built >= maxBuild) break; this.chunks.set(k, this.acquire(cx, cz)); built++; }
  }

  private acquire(cx: number, cz: number): Chunk {
    let ch = this.pool.pop();
    const n = NEAR_N, x0 = cx * NEAR, z0 = cz * NEAR;
    if (!ch) { const m = this.newMesh("groundnear", n); ch = { mesh: m, cx, cz, h: new Float32Array((n + 3) * (n + 3)), active: true, dirty: false, lo: n, hi: 0, loZ: n, hiZ: 0, full: true }; }
    ch.cx = cx; ch.cz = cz; ch.active = true; ch.dirty = false; ch.lo = n; ch.hi = 0; ch.loZ = n; ch.hiZ = 0;
    this.heights(x0, z0, 1, n, ch.h); this.fill(ch.mesh, x0, z0, 1, n, ch.h, null); this.setUV(ch.mesh, x0, z0, 1, n);
    ch.mesh.position.y = 0.012;   // a hair above the far tiles where the two meet
    ch.mesh.setEnabled(true); this.maskChunk(cx, cz, 1);
    return ch;
  }
  private release(ch: Chunk) { this.maskChunk(ch.cx, ch.cz, 0); ch.active = false; ch.mesh.setEnabled(false); this.pool.push(ch); this.dirtyChunks.delete(ch); const t = this.tileAt((ch.cx + 0.5) * NEAR, (ch.cz + 0.5) * NEAR); if (t) this.dirtyTiles.add(t); }
  private refreshChunk(ch: Chunk) {
    if (!ch.active) return;
    const n = NEAR_N, x0 = ch.cx * NEAR, z0 = ch.cz * NEAR, W = n + 3;
    // recompute the heights in the dirty window (plus the ring the normals need), then redraw those vertices
    const i0 = Math.max(-1, ch.lo - 1), i1 = Math.min(n + 1, ch.hi + 1), j0 = Math.max(-1, ch.loZ - 1), j1 = Math.min(n + 1, ch.hiZ + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ch.h[(j + 1) * W + i + 1] = this.height(x0 + i, z0 + j);
    this.fill(ch.mesh, x0, z0, 1, n, ch.h, null, [Math.max(0, i0), Math.min(n, i1), Math.max(0, j0), Math.min(n, j1)]);
    ch.dirty = false; ch.lo = n; ch.hi = 0; ch.loZ = n; ch.hiZ = 0;
  }
}
