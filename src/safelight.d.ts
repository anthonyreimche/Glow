// The slice of Safelight's extension API this extension touches, mirrored from
// the app's src/extensions/types.ts, src/extensions/ui-kit.tsx and
// src/state/develop-store.ts. Extensions are standalone bundles, so the host's
// source is not on the type path; React types come from @types/react (dev only).

import type { Attributes, ComponentType, CSSProperties, ReactElement, ReactNode } from "react";

export interface StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState(): T;
  setState(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: (state: T, prev: T) => void): () => void;
}

export interface DevelopStoreState {
  photoId: string | null;
  /** Extension stage params by qualified key. Values are whatever the owning
   *  stage wrote and come back from sidecar JSON — a runtime boundary. */
  paramBag: Record<string, unknown>;
  setDynParams(patch: Record<string, unknown>): void;
  commitEdit(label: string): Promise<void>;
}

export type GlslType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "sampler2D";

export interface UniformDeclaration {
  key: string;
  glslType: GlslType;
  default: number | number[] | boolean;
  range?: { min: number; max: number; step?: number };
  label?: string;
}

/** A pass whose draw count comes from the bag: the uniform `key`'s value,
 *  rounded and clamped to [0, max]; 0 draws skips the pass, and a stage whose
 *  passes all draw 0 times reads as idle. */
export interface PassDrawCount {
  key: string;
  max: number;
}

export interface StagePass {
  glsl: string;
  helpers?: string;
  iterations?: number | PassDrawCount;
  uniforms?: UniformDeclaration[];
}

export type ProcessingPhase =
  | "geometry"
  | "decode"
  | "noise-reduction"
  | "scene-linear"
  | "tone-map"
  | "display-adjust"
  | "effects"
  | "output-encode";

export interface ProcessingStageContribution {
  id: string;
  name: string;
  phase: ProcessingPhase;
  priority?: number;
  glsl: string;
  helpers?: string;
  uniforms: UniformDeclaration[];
  passes?: StagePass[];
  presetScope?: "global" | "per-image";
  /** What the passes read first: the decoded source, or the image as edited
   *  up to this stage. */
  reads?: "source" | "current";
  /** Runs the stage again inside each mask whose bag holds its keys, with that
   *  mask's values, blended by its coverage (Safelight 3.1.0, process version 2
   *  photos). */
  mask?: { maskable: true };
}

export interface PanelContribution {
  id: string;
  title: string;
  component: ComponentType;
  defaultDock?: {
    module: "library" | "develop";
    direction: "left" | "right" | "bottom";
    order?: number;
    width?: number;
    height?: number;
  };
  onReset?: () => void;
  /** Offers the panel in a mask's Adjust tab: each mask that adds it renders
   *  `component`, which edits that mask's values through useParamScope. `owns`
   *  lists every qualified key it writes, seeded on add and cleared on remove. */
  mask?: { component: ComponentType; order?: number; owns: readonly string[] };
}

/** The params a panel edits: the photo's bag, or one mask's (maskId set).
 *  Reads see the store as it is now, not as the render was handed it. */
export interface ParamScope {
  maskId: string | null;
  getParam(key: string): unknown;
  /** The stored values by qualified key, without defaults. */
  getParams(): Readonly<Record<string, unknown>>;
  setParams(patch: Record<string, unknown>): void;
  commit(label: string): void;
}

export interface SliderProps {
  label: string;
  value: number;
  onChange(value: number): void;
  onCommit?(): void;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface StackProps {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}

export interface UiKit {
  Stack: ComponentType<StackProps>;
  tokens: Readonly<Record<string, string>>;
}

export interface ReactLike {
  createElement<P extends object>(
    type: string | ComponentType<P>,
    props?: (Attributes & P) | null,
    ...children: ReactNode[]
  ): ReactElement;
}

export interface SafelightAPI {
  version: 1;
  extensionId: string;
  react: ReactLike;
  registerProcessingStage(c: ProcessingStageContribution): void;
  unregisterProcessingStage(id: string): void;
  registerPanel(c: PanelContribution): void;
  components: {
    Slider: ComponentType<SliderProps>;
  };
  ui: UiKit;
  stores: {
    useDevelopStore: StoreApi<DevelopStoreState>;
  };
  develop: {
    /** The mask's scope inside a mask's Adjust tab, the photo's anywhere else. */
    useParamScope(): ParamScope;
  };
}

export interface ExtensionModule {
  activate(api: SafelightAPI): void;
  deactivate?(): void;
}
