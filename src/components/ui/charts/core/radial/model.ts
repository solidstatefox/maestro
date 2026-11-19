import type { DomChartDefinition } from "@tanstack/charts";
import type { ChildTable } from "../carriers/table";
import { declarationOf } from "../carriers/table";
import { buildRadialDefinition } from "./definition";
import type { RadialHitRow } from "./definition";
import type { HoverDotSpec, LayerEnterEnv, RadialLayer, ScrubberSpec } from "./layers/types";
import { radialLayerBuilder } from "./roles";
import type { RadialLayerBuilder } from "./roles";
import type { RadialShell } from "./shell";

export { RADIAL_ROLES } from "./roles";

/** The layers' carriers in declaration order (the order they paint in). */
export const radialCarriers = (table: ChildTable): { readonly build: RadialLayerBuilder; readonly props: Readonly<Record<string, unknown>> }[] =>
  [...table].flatMap(([role, list]) => {
    const build = radialLayerBuilder(role);
    return build === undefined ? [] : list.map((props) => ({ build, props }));
  }).sort((a, b) => declarationOf(a.props) - declarationOf(b.props));

export interface RadialModel {
  readonly definition: DomChartDefinition<RadialHitRow, number, number>;
  readonly layers: readonly RadialLayer[];
  /** The overlay's `<defs>` markup. */
  readonly defs: string;
  /** The owned `<style>`'s text. */
  readonly css: string;
  readonly dots: readonly HoverDotSpec[];
  /** The last `RadialScrubber`'s, or `null` without one. */
  readonly scrubber: ScrubberSpec | null;
  /** Marks whose children dim while another bin is hovered. */
  readonly hotMarks: readonly string[];
  /** Runs every layer's decoration after a draw. */
  readonly decorate: (env: LayerEnterEnv) => void;
  /** Starts every layer's entrance. */
  readonly enter: (env: LayerEnterEnv) => void;
}

/** The model of `shell` (measured: radius > 0) and the carriers. */
export function buildRadialModel(shell: RadialShell, table: ChildTable, uid: string): RadialModel {
  const layers = radialCarriers(table).map(({ build, props }, index) => build(props, { shell, index, uid }));
  const marks = layers.flatMap((layer) => layer.marks);
  return {
    definition: buildRadialDefinition(shell, marks),
    layers,
    defs: layers.map((layer) => layer.defs).join(""),
    css: layers.map((layer) => layer.css).join("\n"),
    dots: layers.flatMap((layer) => layer.dots ?? []),
    scrubber: layers.findLast((layer) => layer.scrubber !== undefined)?.scrubber ?? null,
    hotMarks: layers.flatMap((layer) => layer.hotMarks ?? []),
    decorate: (env) => {
      for (const layer of layers) {
        layer.decorate?.(env);
      }
    },
    enter: (env) => {
      for (const layer of layers) {
        layer.enter?.(env);
      }
    },
  };
}
