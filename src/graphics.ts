import {
  Scene, Camera, DefaultRenderingPipeline, SSAO2RenderingPipeline, ImageProcessingConfiguration, ColorCurves, GlowLayer, Color4,
} from "@babylonjs/core";
import type { Rig } from "./rig";

export type Quality = 0 | 1 | 2;
export const QUALITY_NAMES = ["LOW", "MED", "HIGH"] as const;

/**
 * LOW  – no post-processing (phones / weak GPUs): cheap glow layer only.
 * MED  – FXAA, ACES tone mapping, bloom, vignette, sharpen, bump mapping.
 * HIGH – MED + 4x MSAA + screen-space ambient occlusion.
 */
export class Graphics {
  level: Quality = 1;
  private pipe: DefaultRenderingPipeline | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;

  constructor(private scene: Scene, private camera: Camera, private glow: GlowLayer | null, private rig: Rig) {}

  /** Weak/software GPUs (Intel UHD, Mesa, SwiftShader…) default to LOW; everything else MED. */
  static defaultFor(isTouch: boolean, renderer: string): Quality {
    if (isTouch) return 0;
    return /intel|swiftshader|llvmpipe|software|mesa|microsoft basic/i.test(renderer) ? 0 : 1;
  }
  static saved(isTouch: boolean, renderer = ""): Quality {
    try {
      const v = localStorage.getItem("rcmh_gfx");
      if (v !== null && ["0", "1", "2"].includes(v)) return Number(v) as Quality;
    } catch { /* storage unavailable */ }
    return Graphics.defaultFor(isTouch, renderer);
  }

  set(level: Quality) {
    this.level = level;
    try { localStorage.setItem("rcmh_gfx", String(level)); } catch { /* ignore */ }
    this.rig.setBump(level >= 1);

    if (level === 0) {
      this.pipe?.dispose(); this.pipe = null;
      this.ssao?.dispose(); this.ssao = null;
      if (this.glow) this.glow.isEnabled = true;
      return;
    }
    if (this.glow) this.glow.isEnabled = false;   // the pipeline's bloom replaces it
    if (!this.pipe) {
      const p = new DefaultRenderingPipeline("gfx", true, this.scene, [this.camera]);
      p.bloomEnabled = true; p.bloomThreshold = 0.82; p.bloomWeight = 0.3; p.bloomKernel = 48; p.bloomScale = 0.5;
      p.sharpenEnabled = true; p.sharpen.edgeAmount = 0.22; p.sharpen.colorAmount = 1;
      p.imageProcessingEnabled = true;
      const ip = p.imageProcessing;
      // No filmic tone map: it desaturates the palette. Contrast + a saturation lift keeps the paint colours punchy.
      ip.toneMappingEnabled = false; ip.exposure = 1.0; ip.contrast = 1.18;
      ip.colorCurvesEnabled = true; const cc = new ColorCurves(); cc.globalSaturation = 22; cc.globalExposure = 4; ip.colorCurves = cc;
      ip.vignetteEnabled = true; ip.vignetteWeight = 1.3; ip.vignetteStretch = 0.2; ip.vignetteColor = new Color4(0, 0, 0, 0); ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
      this.pipe = p;
    }
    this.pipe.samples = level >= 2 ? 4 : 1;
    this.pipe.fxaaEnabled = level < 2;

    if (level >= 2) {
      if (!this.ssao) {
        const s = new SSAO2RenderingPipeline("ssao", this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.camera], true);
        s.radius = 2.2; s.totalStrength = 0.85; s.base = 0.1; s.maxZ = 90; s.samples = 12; s.expensiveBlur = false;
        this.ssao = s;
      }
    } else if (this.ssao) { this.ssao.dispose(); this.ssao = null; }
  }

  cycle(): Quality { const n = ((this.level + 1) % 3) as Quality; this.set(n); return n; }
}
