import { LoadAssetContainerAsync, Matrix, Mesh, PBRMaterial, StandardMaterial, TransformNode, Color3, Vector3 } from "@babylonjs/core";
import type { Scene, Material } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * Blender-authored props and crew (tools/blender/make_rig_kit.py).
 * Models are cosmetic: collision stays with the AABBs in rig.ts.
 *
 * Handedness: the glTF loader parents everything under a mirrored root. We bake that transform into each mesh's
 * vertices (flipping faces) so templates are plain left-handed meshes with no parent, then confirm the front faces +Z by
 * looking at the nose mesh (Blender -Y must end up as +Z).
 */
export class Kit {
  /** every template mesh by node name (e.g. "thigh_pants", "bop") */
  templates = new Map<string, Mesh>();
  private std = new Map<string, StandardMaterial>();
  lampMat: StandardMaterial | null = null;
  casters: Mesh[] = [];
  frontFlipped = false;

  private constructor(private scene: Scene) {}

  static async load(scene: Scene, base = import.meta.env.BASE_URL + "models/"): Promise<Kit | null> {
    const kit = new Kit(scene);
    const files = ["human_parts", "bop", "pump", "genset", "lighttower", "trailer", "pipe"];
    try {
      const boxes = await Promise.all(files.map((f) => LoadAssetContainerAsync(base + f + ".glb", scene)));
      const fix = Matrix.Scaling(-1, 1, 1);
      for (const c of boxes) {
        for (const m of c.meshes) {
          if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
          const wm = m.computeWorldMatrix(true).clone();
          m.parent = null; m.position.setAll(0); m.rotationQuaternion = null; m.rotation.setAll(0); m.scaling.setAll(1);
          m.bakeTransformIntoVertices(wm.multiply(fix));
          m.refreshBoundingInfo();
          m.material = kit.toStandard(m.material);
          m.isPickable = false; m.setEnabled(false);
          kit.templates.set(m.name, m);
        }
      }
      // orientation check: the nose must point toward +Z
      const nose = kit.templates.get("nose_skin");
      if (nose && nose.getBoundingInfo().boundingBox.center.z < 0) {
        kit.frontFlipped = true;
        const rot = Matrix.RotationY(Math.PI);
        for (const m of kit.templates.values()) { m.bakeTransformIntoVertices(rot); m.refreshBoundingInfo(); }
      }
      return kit;
    } catch (e) {
      console.warn("Blender kit failed to load; falling back to procedural geometry", e);
      return null;
    }
  }

  private toStandard(m: Material | null | undefined): StandardMaterial {
    const name = m?.name ?? "steel";
    const hit = this.std.get(name);
    if (hit) return hit;
    const s = new StandardMaterial("k_" + name, this.scene);
    if (m instanceof PBRMaterial) {
      s.diffuseColor = m.albedoColor.clone();
      if (m.emissiveColor && (m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b) > 0.05) { s.emissiveColor = m.emissiveColor.scale(Math.max(0.5, m.emissiveIntensity ?? 1)); s.diffuseColor = Color3.Black(); }
    }
    s.specularColor = new Color3(0.14, 0.14, 0.14);
    if (name === "lamp") this.lampMat = s;
    this.std.set(name, s);
    return s;
  }

  /** Share the rig's dynamic lamp material (night glow) with all kit lamp lenses. */
  useLampMaterial(mat: StandardMaterial) {
    for (const m of this.templates.values()) if (m.material === this.lampMat) m.material = mat;
    this.lampMat = mat;
    this.std.set("lamp", mat);
  }

  has(name: string) { return this.templates.has(name); }

  /** Clone every mesh whose name is `prefix` or starts with `prefix_` under one transform node. */
  place(prefix: string, x: number, y: number, z: number, rotY = 0, scale = 1, shadow = true): TransformNode {
    const w = new TransformNode(prefix + "Wrap", this.scene);
    w.position.set(x, y, z); w.rotation.y = rotY; w.scaling.setAll(scale);
    for (const [n, t] of this.templates) {
      if (n !== prefix && !n.startsWith(prefix + "_")) continue;
      const c = t.clone(n + "_i", w) as Mesh;
      c.setEnabled(true); c.isPickable = false; c.receiveShadows = true;
      if (shadow) this.casters.push(c);
    }
    return w;
  }

  /** many copies of a prop as GPU thin instances (drill pipe on the racks): one draw call per material. */
  instances(prefixes: string[], positions: Vector3[], shadow = false) {
    for (const p of prefixes) for (const [n, t] of this.templates) {
      if (n !== p && !n.startsWith(p + "_primitive")) continue;
      const c = t.clone(n + "_inst") as Mesh; c.setEnabled(true); c.isPickable = false; c.receiveShadows = true;
      for (const pos of positions) c.thinInstanceAdd(Matrix.Translation(pos.x, pos.y, pos.z));
      c.thinInstanceRefreshBoundingInfo(true);
      if (shadow) this.casters.push(c);
    }
  }
}
