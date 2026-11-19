import { useMemo } from "react";
import type { CSSProperties, ReactElement, ReactNode, RefObject } from "react";
import { FocusLayer } from "../kit/cartesian/focus-layer";
import type { ChartContextValue } from "../kit/cartesian/chart-context";
import { useGateReady } from "../kit/entrance/reveal-arm";
import { BarLoadingSkeleton } from "../kit/loading/bar-skeleton";
import { useResizeBox } from "../kit/size/use-resize-box";
import { toCamel } from "../core/style";
import { BarDepthConfigProvider } from "./depth-entries";
import { barInnerSize } from "../core/bar/context";
import type { BarController } from "../core/bar/controller";
import type { BarView } from "../core/bar/view";

interface BarSizedLayerProps {
  readonly controller: BarController;
  readonly view: BarView;
  readonly host: RefObject<HTMLDivElement | null>;
  readonly custom: ReactNode;
}

export const BarSizedLayer = ({ controller, view, host, custom }: BarSizedLayerProps): ReactElement => {
  const { skeleton } = view;
  // SAFETY: the core's style objects hold CSS properties only.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  const skeletonStyle = useMemo(() => (skeleton ? (toCamel(skeleton.style) as CSSProperties) : undefined), [skeleton]);
  const size = useResizeBox(host, undefined, true);
  const { innerWidth, innerHeight } = barInnerSize(size, view.margin);
  // Public `useChart()` context, derived from the native focus + resolved domains; isLoaded follows the chart's ready gate.
  const useContextValue = (): ChartContextValue => {
    useGateReady(controller.ready);
    return controller.contextAt(size);
  };
  return (
    <>
      {skeleton ? (
        <svg aria-hidden="true" height={innerHeight} style={skeletonStyle} width={innerWidth}>
          <BarLoadingSkeleton barCount={skeleton.barCount} fill={skeleton.fill} innerHeight={innerHeight} innerWidth={innerWidth} />
        </svg>
      ) : null}
      <FocusLayer store={controller.focus} useContextValue={useContextValue}>
        <BarDepthConfigProvider value={view.depthConfig}>{custom}</BarDepthConfigProvider>
      </FocusLayer>
    </>
  );
};
