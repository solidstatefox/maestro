let canvasContext: CanvasRenderingContext2D | null | undefined = undefined;

/** The shared measuring canvas context with `font` set, or null where there is no document (SSR). */
export const fontContext = (fontSize: number, fontWeight: number, fontFamily: string): CanvasRenderingContext2D | null => {
  if (canvasContext === undefined) {
    canvasContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (canvasContext) { canvasContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`; }
  return canvasContext;
};

/** Canvas text width; without a canvas, `length * fontSize * fallbackRatio`. */
export const textWidth = (value: string, fontSize: number, fontWeight: number, fontFamily: string, fallbackRatio: number): number =>
  fontContext(fontSize, fontWeight, fontFamily)?.measureText(value).width ?? value.length * fontSize * fallbackRatio;
