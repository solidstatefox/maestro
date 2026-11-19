import { useContext, useEffect, useMemo, useState } from "react";
import type { Context } from "react";
import { createBridgedHover, polarHoverValue } from "../../core/polar/hover";
import type { HoverSource } from "../../core/polar/hover";
import type { PolarHoverValue } from "../../core/types/polar";
import { useHoverIndex } from "./polar-hover";

const useRequiredContext = <Held,>(context: Context<Held>, message: string): NonNullable<Held> => {
  const value = useContext(context);
  if (value === null || value === undefined) { throw new Error(message); }
  return value;
};

const useHoverValue = (coordinator: HoverSource): PolarHoverValue => {
  const hoveredIndex = useHoverIndex(coordinator);
  return useMemo(() => polarHoverValue(coordinator, hoveredIndex), [coordinator, hoveredIndex]);
};

const useBridgedCoordinator = (hoveredIndex: number | null, setHoveredIndex: (index: number | null) => void): HoverSource => {
  const [bridge] = useState(() => createBridgedHover(hoveredIndex));
  useEffect(() => { bridge.sync(hoveredIndex); }, [bridge, hoveredIndex]);
  useEffect(() => bridge.listen(setHoveredIndex), [bridge, setHoveredIndex]);
  return bridge.source;
};

export { useBridgedCoordinator, useHoverValue, useRequiredContext };
