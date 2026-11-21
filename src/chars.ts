import { LoadAssetContainerAsync, AssetContainer, Scene, TransformNode, AnimationGroup, AbstractMesh, Skeleton } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/** One animated, skinned character instance (own skeleton and animation groups). */
export interface CharInstance {
  holder: TransformNode;
  meshes: AbstractMesh[];
  skeleton: Skeleton | null;
  idle: AnimationGroup | null; walk: AnimationGroup | null; run: AnimationGroup | null;
  /** find a bone's transform node by (suffix of) its name, e.g. "Head" */
  bone(name: string): TransformNode | null;
  dispose(): void;
}

/**
 * A rigged character model (Mixamo-style skeleton) loaded once and instanced per person.
 * Swap `public/models/chars/<file>` (or pass ?char=<file>) to change who everybody looks like.
 */
export class CharKit {
  private n = 0;
  private constructor(private scene: Scene, private box: AssetContainer, public height: number) {}

  static async load(scene: Scene, file: string, base = import.meta.env.BASE_URL + "models/chars/"): Promise<CharKit | null> {
    try {
      const box = await LoadAssetContainerAsync(base + file, scene);
      // measure once on a throwaway instance
      const probe = box.instantiateModelsToScene((nm) => nm + "_probe", false);
      const root = probe.rootNodes[0] as TransformNode;
      root.computeWorldMatrix(true);
      const { min, max } = root.getHierarchyBoundingVectors(true, (m) => m.isVisible);
      const height = Math.max(0.5, max.y - min.y);
      probe.animationGroups.forEach((g) => g.dispose());
      root.dispose();
      probe.skeletons.forEach((s) => s.dispose());
      return new CharKit(scene, box, height);
    } catch (e) {
      console.warn("Character model failed to load; falling back to the Blender kit", e);
      return null;
    }
  }

  instantiate(target = 1.8): CharInstance {
    const id = "_c" + this.n++;
    const inst = this.box.instantiateModelsToScene((nm) => nm + id, true);
    const holder = new TransformNode("char" + id, this.scene);
    const roots = inst.rootNodes as TransformNode[];
    roots.forEach((r) => { r.parent = holder; });
    holder.scaling.setAll(target / this.height);
    const meshes = roots.flatMap((r) => r.getChildMeshes(false)) as AbstractMesh[];
    const find = (re: RegExp) => inst.animationGroups.find((g) => re.test(g.name)) ?? null;
    const idle = find(/idle/i), walk = find(/walk/i) ?? (inst.animationGroups.length === 1 ? inst.animationGroups[0] : null), run = find(/run/i);
    inst.animationGroups.forEach((g) => { g.stop(); g.enableBlending = true; g.blendingSpeed = 0.07; g.loopAnimation = true; });
    const nodes = roots.flatMap((r) => [r, ...r.getChildTransformNodes(false)]);
    return {
      holder, meshes, skeleton: inst.skeletons[0] ?? null, idle, walk, run,
      bone: (name) => nodes.find((n) => n.name.replace(id, "").replace(/^.*:/, "").toLowerCase() === name.toLowerCase()) ?? null,
      dispose: () => { inst.animationGroups.forEach((g) => g.dispose()); holder.dispose(false, true); },
    };
  }
}
