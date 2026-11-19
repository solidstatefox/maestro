import { Children, isValidElement, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { HoverReader } from "../../core/polar/hover";

const useHoverIndex = (source: HoverReader): number | null =>
  useSyncExternalStore(source.subscribe, source.getHovered, source.getHovered);

/** Hover index committed on React's default lane (a scheduler task after the pointer event, as bklit's setState), so a consumer's heavy commit stays out of the pointer task. */
const useScheduledHoverIndex = (source: HoverReader): number | null => {
  const [index, setIndex] = useState(source.getHovered);
  useEffect(() => {
    const sync = (): void => { setIndex(source.getHovered()); };
    sync();
    return source.subscribe(sync);
  }, [source]);
  return index;
};

// --- Children --------------------------------------------------------------------------------
interface ClassifyPolarOptions<TConfig> {
  readonly isCenter: (child: ReactElement) => boolean;
  readonly isDefs?: (child: ReactElement) => boolean;
  readonly configOf?: (child: ReactElement) => TConfig | undefined;
}

interface ClassifiedPolarChildren<TConfig> {
  readonly centerChildren: ReactNode[];
  readonly configs: TConfig[];
  readonly defsChildren: ReactElement[];
}

/** Splits children into the center overlay, SVG resource defs and config carriers (Slice/Ring). */
const classifyPolarChildren = <TConfig>(children: ReactNode, options: Readonly<ClassifyPolarOptions<TConfig>>): ClassifiedPolarChildren<TConfig> => {
  const centerChildren: ReactNode[] = [];
  const defsChildren: ReactElement[] = [];
  const configs: TConfig[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) { return; }
    if (options.isCenter(child)) {
      centerChildren.push(child);
    } else if (options.isDefs?.(child) === true) {
      defsChildren.push(child);
    } else {
      const config = options.configOf?.(child);
      if (config !== undefined) { configs.push(config); }
    }
  });
  return { centerChildren, configs, defsChildren };
};

export { classifyPolarChildren, useHoverIndex, useScheduledHoverIndex };
