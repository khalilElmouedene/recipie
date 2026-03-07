import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export type ActiveTool = "select" | "text" | "image" | "band" | "frame";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type LeftTab = "elements" | "layers" | "templates";

export interface Layer {
  id: string;
  label: string;
  type: string;
}

export interface TextProps {
  editText: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textAlign: string;
  textColor: string;
}

export interface BandProps {
  bandOpacity: number;
  bandFill: string;
}

export interface FrameProps {
  strokeWidth: number;
  strokeColor: string;
  strokeStyle: StrokeStyle;
  rx: number;
}

export interface ImageProps {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
}

export interface ShapeProps {
  fill: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
}

interface DesignerState {
  // Selection
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;

  // Active tool
  activeTool: ActiveTool;
  setActiveTool: (t: ActiveTool) => void;

  // Layers panel
  layers: Layer[];
  setLayers: (layers: Layer[]) => void;

  // Left tab
  leftTab: LeftTab;
  setLeftTab: (tab: LeftTab) => void;

  // Zoom (CSS %)
  zoom: number;
  setZoom: (z: number) => void;

  // Text editing state
  textProps: TextProps;
  setTextProps: (props: Partial<TextProps>) => void;

  // Band state
  bandProps: BandProps;
  setBandProps: (props: Partial<BandProps>) => void;

  // Frame state
  frameProps: FrameProps;
  setFrameProps: (props: Partial<FrameProps>) => void;

  // Image transform state
  imageProps: ImageProps;
  setImageProps: (props: Partial<ImageProps>) => void;

  // Shape state
  shapeProps: ShapeProps;
  setShapeProps: (props: Partial<ShapeProps>) => void;

  // Floating toolbar position (screen coords)
  toolbarPos: { x: number; y: number } | null;
  setToolbarPos: (pos: { x: number; y: number } | null) => void;

  // Reset all UI state (called on designer unmount)
  resetStore: () => void;
}

export const useDesignerStore = create<DesignerState>()(
  subscribeWithSelector((set) => ({
    selectedId: null,
    setSelectedId: (id) => set({ selectedId: id }),

    activeTool: "select",
    setActiveTool: (t) => set({ activeTool: t }),

    layers: [],
    setLayers: (layers) => set({ layers }),

    leftTab: "templates",
    setLeftTab: (leftTab) => set({ leftTab }),

    zoom: 35,
    setZoom: (z) => set({ zoom: Math.max(20, Math.min(200, z)) }),

    textProps: {
      editText: "",
      fontFamily: "Arial",
      fontSize: 32,
      fontWeight: "normal",
      textAlign: "center",
      textColor: "#333333",
    },
    setTextProps: (props) =>
      set((s) => ({ textProps: { ...s.textProps, ...props } })),

    bandProps: { bandOpacity: 1, bandFill: "#ffffff" },
    setBandProps: (props) =>
      set((s) => ({ bandProps: { ...s.bandProps, ...props } })),

    frameProps: {
      strokeWidth: 4,
      strokeColor: "#333333",
      strokeStyle: "solid",
      rx: 0,
    },
    setFrameProps: (props) =>
      set((s) => ({ frameProps: { ...s.frameProps, ...props } })),

    imageProps: { left: 0, top: 0, width: 0, height: 0, angle: 0 },
    setImageProps: (props) =>
      set((s) => ({ imageProps: { ...s.imageProps, ...props } })),

    shapeProps: { fill: "#6366f1", strokeColor: "#333333", strokeWidth: 0, opacity: 100 },
    setShapeProps: (props) =>
      set((s) => ({ shapeProps: { ...s.shapeProps, ...props } })),

    toolbarPos: null,
    setToolbarPos: (pos) => set({ toolbarPos: pos }),

    resetStore: () => set({
      selectedId: null,
      activeTool: "select",
      layers: [],
      leftTab: "templates",
      zoom: 35,
      toolbarPos: null,
    }),
  }))
);
