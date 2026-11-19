import { barX, defineChart, dot, link, ruleX, text } from "@tanstack/charts";
import type { ChartCurve, ChartPoint } from "@tanstack/charts";
import { focusNearestY } from "@tanstack/charts/focus";
import { scaleBand } from "@tanstack/charts/scales/band";
import { propsFor } from "../carriers/table";
import type { GridGuideProps } from "../cartesian/grid-guides";
import { toDate } from "../cartesian/series";
import { erase } from "../erased-types";
import { shortDateFmt } from "../format";
import { memoCell } from "../memo";
import { scaleTime } from "../scales";
import { bklitTheme, DEFAULT_MARGIN } from "../theme";
import type { ChartMargin } from "../theme";
import type { TooltipBoxMotionProps } from "../tooltip/box-motion";
import type { GanttChartProps, GanttDependenciesProps, GanttTask, GanttTasksProps, GanttTodayProps, GanttXAxisProps, GanttYAxisProps } from "../types/gantt";
import type { TooltipRow } from "../types/tooltip";
import { hoverDimCss, lateFadeCss, PLOT_FADE_KEYFRAMES } from "../plot/css";
import { categoryDomain, enterMotion, focusCopy, itemKey, plotEnter, plotTooltip, scaleGrid, stagger, TICK_LABELS } from "../plot/definition";
import { skeletonBetween } from "../plot/loading";
import type { PlotSkeleton, SkeletonShape } from "../plot/loading";
import type { PlotBuild, PlotBuildInput, PlotDatum, PlotFamily, PlotItem } from "../plot/types";
import { describeGantt } from "../plot/describe";

/** The props a GanttChart hands its controller (the adapter keeps `className`, `style` and `children`). */
export type GanttProps = Omit<GanttChartProps<unknown, unknown>, "className" | "style" | "children">;

/** One row of the chart: a phase (its tasks rolled up), a task or a milestone. */
interface Lane {
  readonly index: number;
  readonly kind: "phase" | "task" | "milestone";
  readonly id: string;
  readonly name: string;
  readonly start: Date;
  readonly end: Date;
  readonly progress: number | undefined;
  readonly color: string;
  /** The reader's row (a phase's is made up: `name`, `start`, `end`, `progress`, `tasks`). */
  readonly row: PlotDatum;
  /** The row's index in `data` (-1 for a phase). */
  readonly dataIndex: number;
  /** Under a phase. */
  readonly nested: boolean;
  /** The names of the tasks it waits for. */
  readonly after: readonly string[];
}

interface Dependency {
  readonly from: Lane;
  readonly to: Lane;
}

const DAY_MS = 86_400_000;
const DEFAULT_ROW_HEIGHT = 36;
const DEFAULT_LABEL_WIDTH = 168;
const MARK = {
  track: "gantt-track",
  progress: "gantt-progress",
  phase: "gantt-phase",
  phaseBg: "gantt-phase-bg",
  milestone: "gantt-ms",
  deps: "gantt-deps",
  labels: "gantt-labels",
  phaseLabels: "gantt-phase-labels",
  today: "gantt-today",
  todayLabel: "gantt-today-label",
  hit: "gantt-hit",
} as const;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const finiteTime = (date: Date): boolean => Number.isFinite(date.getTime());

/** The rows top to bottom: a phase row before the first task of each `group`, its tasks gathered under it in data order. */
function lanesOf(data: readonly GanttTask[], fill: string): Lane[] {
  const groups = new Map<string, { readonly tasks: { readonly task: GanttTask; readonly dataIndex: number }[] }>();
  for (const [dataIndex, task] of data.entries()) {
    if (task.group !== undefined) {
      const group = groups.get(task.group) ?? { tasks: [] };
      group.tasks.push({ task, dataIndex });
      groups.set(task.group, group);
    }
  }
  const nameOf = new Map(data.map((task) => [task.id, task.name] as const));
  const lanes: Lane[] = [];
  const taskLane = (task: GanttTask, dataIndex: number, nested: boolean): Lane => {
    const start = toDate(task.start);
    const milestone = task.milestone === true || task.end === undefined;
    const end = milestone ? start : toDate(task.end);
    return {
      index: lanes.length,
      kind: milestone ? "milestone" : "task",
      id: task.id,
      name: task.name,
      start,
      end: end.getTime() < start.getTime() ? start : end,
      progress: task.progress === undefined ? undefined : clamp01(task.progress),
      color: task.color ?? fill,
      // SAFETY: a task is a plain record of the reader's.
      row: task as unknown as PlotDatum,
      dataIndex,
      nested,
      after: (task.dependsOn ?? []).flatMap((id) => nameOf.get(id) ?? []),
    };
  };
  const emitted = new Set<string>();
  for (const [dataIndex, task] of data.entries()) {
    if (task.group === undefined) {
      lanes.push(taskLane(task, dataIndex, false));
      continue;
    }
    if (emitted.has(task.group)) {
      continue;
    }
    emitted.add(task.group);
    const members = groups.get(task.group)?.tasks ?? [];
    const starts = members.map((m) => toDate(m.task.start).getTime()).filter(Number.isFinite);
    const ends = members.map((m) => toDate(m.task.end ?? m.task.start).getTime()).filter(Number.isFinite);
    // A phase's progress: its tasks' done share weighted by their length.
    let weight = 0;
    let done = 0;
    for (const { task: t } of members) {
      const span = Math.max(DAY_MS, toDate(t.end ?? t.start).getTime() - toDate(t.start).getTime());
      weight += span;
      done += span * clamp01(t.progress ?? 0);
    }
    const start = new Date(Math.min(...starts));
    const end = new Date(Math.max(...ends));
    const progress = weight > 0 ? done / weight : undefined;
    lanes.push({
      index: lanes.length,
      kind: "phase",
      id: `phase:${task.group}`,
      name: task.group,
      start,
      end,
      progress,
      color: fill,
      row: { name: task.group, start, end, progress, tasks: members.length },
      dataIndex: -1,
      nested: false,
      after: [],
    });
    for (const member of members) {
      lanes.push(taskLane(member.task, member.dataIndex, true));
    }
  }
  return lanes.filter((lane) => finiteTime(lane.start) && finiteTime(lane.end));
}

function dependenciesOf(lanes: readonly Lane[], data: readonly GanttTask[]): Dependency[] {
  const byId = new Map(lanes.filter((lane) => lane.kind !== "phase").map((lane) => [lane.id, lane] as const));
  const deps: Dependency[] = [];
  for (const task of data) {
    const to = byId.get(task.id);
    for (const id of task.dependsOn ?? []) {
      const from = byId.get(id);
      if (to && from && from !== to) {
        deps.push({ from, to });
      }
    }
  }
  return deps;
}

/** `points` joined by straight runs whose corners are rounded by `r`. */
function roundedPath(points: readonly (readonly [number, number])[], r: number): string {
  const [first] = points;
  if (first === undefined) {
    return "";
  }
  let d = `M${first[0]},${first[1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1] ?? first;
    const [cx, cy] = points[i] ?? first;
    const [nx, ny] = points[i + 1] ?? first;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k <= 0) {
      d += `L${cx},${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / inLen) * k;
    const ay = cy - ((cy - py) / inLen) * k;
    const bx = cx + ((nx - cx) / outLen) * k;
    const by = cy + ((ny - cy) / outLen) * k;
    d += `L${ax},${ay}Q${cx},${cy} ${bx},${by}`;
  }
  const last = points.at(-1) ?? first;
  return `${d}L${last[0]},${last[1]}`;
}

const HEAD = 4.5;
const GAP = 8;
const CORNER = 4;

/** A finish-to-start connector from the predecessor's end to the successor's start: out right, along the gutter between the lanes when the
 * successor starts before there is room for a direct step, in from the left, with an open arrowhead touching the successor's bar. */
/** How far in from its endpoints a connector starts and stops (a milestone's diamond corner). */
interface Insets {
  readonly start: number;
  readonly end: number;
}

const elbowCurve = (rowHeight: number, insets: Insets): ChartCurve => ({
  line: (points) => {
    const [a, b] = points;
    if (a === undefined || b === undefined) {
      return "";
    }
    const [x1start, y1] = a;
    const [x2end, y2] = b;
    const x1 = x1start + insets.start;
    const x2 = x2end - insets.end;
    const dir = Math.sign(y2 - y1) || 1;
    const out = x1 + GAP;
    const route: [number, number][] = x2 - GAP >= out
      ? [[x1, y1], [out, y1], [out, y2], [x2 - 1, y2]]
      : [[x1, y1], [out, y1], [out, y2 - (dir * rowHeight) / 2], [x2 - GAP, y2 - (dir * rowHeight) / 2], [x2 - GAP, y2], [x2 - 1, y2]];
    const tip = x2 - 1;
    return `${roundedPath(route, CORNER)}M${tip - HEAD},${y2 - HEAD}L${tip},${y2}L${tip - HEAD},${y2 + HEAD}`;
  },
  area: () => "",
});

/** A milestone's diamond, centred on its point (the link's two points coincide). */
const diamondCurve = (size: number): ChartCurve => ({
  line: (points) => {
    const [a] = points;
    if (a === undefined) {
      return "";
    }
    const [x, y] = a;
    return `M${x},${y - size}L${x + size},${y}L${x},${y + size}L${x - size},${y}Z`;
  },
  area: () => "",
});

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const daysBetween = (start: Date, end: Date): number => Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
const percent = (value: number): string => `${Math.round(value * 100)}%`;
const NONE = "transparent";

function laneRows(lane: Lane): TooltipRow[] {
  if (lane.kind === "milestone") {
    return [{ color: lane.color, label: "Date", value: shortDateFmt.format(lane.start) }, ...(lane.after.length > 0 ? [{ color: NONE, label: "After", value: lane.after.join(", ") }] : [])];
  }
  const rows: TooltipRow[] = [];
  if (lane.progress !== undefined) {
    rows.push({ color: lane.color, label: "Progress", value: percent(lane.progress) });
  }
  rows.push(
    { color: rows.length === 0 ? lane.color : NONE, label: "Start", value: shortDateFmt.format(lane.start) },
    { color: NONE, label: "End", value: shortDateFmt.format(lane.end) },
    { color: NONE, label: "Duration", value: plural(daysBetween(lane.start, lane.end), "day") },
  );
  if (lane.kind === "phase") {
    rows.push({ color: NONE, label: "Tasks", value: String(lane.row.tasks) });
  }
  if (lane.after.length > 0) {
    rows.push({ color: NONE, label: "After", value: lane.after.join(", ") });
  }
  return rows;
}

/** The domain: every start and end, a little air on each side, from the status date too. */
function timeDomain(lanes: readonly Lane[], today: Date | undefined): [Date, Date] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const lane of lanes) {
    lo = Math.min(lo, lane.start.getTime());
    hi = Math.max(hi, lane.end.getTime());
  }
  if (today && finiteTime(today)) {
    lo = Math.min(lo, today.getTime());
    hi = Math.max(hi, today.getTime());
  }
  if (!Number.isFinite(lo)) {
    const now = Date.UTC(2026, 0, 1);
    return [new Date(now), new Date(now + 30 * DAY_MS)];
  }
  const pad = Math.max(DAY_MS, (hi - lo) * 0.02);
  return [new Date(lo - pad), new Date(hi + pad)];
}

const keyOfLane = (lane: Lane): string => itemKey(lane.index);
const laneValue = (lane: Lane): string => String(lane.index);

type LaneMark = ReturnType<typeof barX>;

/** A dependency as its hover copies hold it: the task at one end (the copy's datum, so `match: "key"` lights it with that task) and the link. */
interface DependencyEnd {
  readonly lane: Lane;
  readonly dep: Dependency;
}

/** Skeleton rows when there are no tasks yet. */
const SKELETON_ROWS = 6;

/** The skeleton's geometry for one chart. */
interface GanttSkeletonInput {
  /** The rows' kinds (a placeholder with no data: tasks). */
  readonly kinds: readonly Lane["kind"][];
  readonly nested: readonly boolean[];
  readonly rowHeight: number;
  readonly thickness: number;
  readonly radius: number;
  /** The name gutter's width (0: no names). */
  readonly labelWidth: number;
}

/** The loading skeleton: a row per lane (six without data) cascading down the schedule, a bar per task, a thin bar per phase, a dot per
 * milestone, and a pill where each name goes in the gutter. */
const ganttSkeleton = ({ kinds, nested, rowHeight, thickness, radius, labelWidth }: GanttSkeletonInput): PlotSkeleton => {
  const n = kinds.length;
  const spans = kinds.map((_, i): readonly [number, number] => {
    const start = (n <= 1 ? 0 : (i / (n - 1)) * 0.62) + skeletonBetween(i, 0, 0.08, 67);
    return [start, Math.min(0.98, start + skeletonBetween(i, 0.14, 0.32, 71))];
  });
  // A phase rolls its tasks up, as the chart's does: from the first one's start to the last one's end.
  for (const [i, kind] of kinds.entries()) {
    let last = i;
    while (kind === "phase" && nested[last + 1] === true) {
      last += 1;
    }
    if (last > i) {
      const members = spans.slice(i + 1, last + 1);
      spans[i] = [Math.min(...members.map((m) => m[0])), Math.max(...members.map((m) => m[1]))];
    }
  }
  return ({ width }) =>
    kinds.flatMap((kind, i): SkeletonShape[] => {
      const center = (i + 0.5) * rowHeight;
      const [from, to] = spans[i] ?? [0, 0.2];
      const shapes: SkeletonShape[] = [];
      if (kind === "milestone") {
        shapes.push({ kind: "dot", x: from * width, y: center, r: Math.max(5, thickness * 0.42) });
      } else {
        const thick = kind === "phase" ? Math.max(4, thickness * 0.32) : thickness;
        shapes.push({ kind: "rect", x: from * width, y: center - thick / 2, width: (to - from) * width, height: thick, radius: kind === "phase" ? 2 : radius, tone: kind === "phase" ? 0.7 : 1 });
      }
      if (labelWidth > 0) {
        const indent = nested[i] === true ? 16 : 4;
        shapes.push({ kind: "rect", x: -labelWidth + indent, y: center - 4, width: Math.min(labelWidth - indent - 16, skeletonBetween(i, 56, 112, 73)), height: 8, radius: 4, tone: 0.7 });
      }
      return shapes;
    });
};

/** The Gantt family's builder (core/plot/types.ts `PlotFamily`). */
function createGanttBuilder(): PlotFamily<GanttProps>["build"] {
  const cell = memoCell<PlotBuild>();
  return ({ props, table, scope, size }: PlotBuildInput<GanttProps>): PlotBuild => {
    const tasks = propsFor<GanttTasksProps>(table, "ganttTasks").at(0);
    const depsProps = propsFor<GanttDependenciesProps>(table, "ganttDependencies").at(0);
    const today = propsFor<GanttTodayProps>(table, "ganttToday").at(0);
    const xAxis = propsFor<GanttXAxisProps>(table, "ganttXAxis").at(0);
    const yAxis = propsFor<GanttYAxisProps>(table, "ganttYAxis").at(0);
    const grid = propsFor<GridGuideProps>(table, "grid").at(0);
    const tooltipProps = propsFor<TooltipBoxMotionProps>(table, "tooltip").at(0);
    return cell([props, tasks, depsProps, today, xAxis, yAxis, grid, tooltipProps], () => {
      const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
      const fill = tasks?.fill ?? "var(--chart-1)";
      const lanes = lanesOf(props.data, fill);
      const deps = depsProps === undefined ? [] : dependenciesOf(lanes, props.data);
      const todayDate = today === undefined ? undefined : toDate(today.date);
      const todayLabel = today?.label ?? "Today";
      const axisTop = (xAxis?.position ?? "top") === "top";
      const labelWidth = yAxis === undefined ? 0 : (yAxis.width ?? DEFAULT_LABEL_WIDTH);
      const margin: ChartMargin = {
        top: props.margin?.top ?? (xAxis !== undefined && axisTop ? 36 : 12),
        right: props.margin?.right ?? 24,
        bottom: props.margin?.bottom ?? ((xAxis !== undefined && !axisTop) || (todayDate !== undefined && todayLabel !== "") ? 36 : 12),
        left: (props.margin?.left ?? DEFAULT_MARGIN.left / 4) + labelWidth,
      };
      const domain = timeDomain(lanes, todayDate);
      const enter = plotEnter(props);
      const delayOf = stagger(enter, lanes.length);
      const barSize = Math.min(1, Math.max(0.1, tasks?.barSize ?? 0.56));
      const thickness = rowHeight * barSize;
      const radius = Math.min(tasks?.radius ?? 6, thickness / 2);
      const showProgress = tasks?.showProgress !== false;
      const bars = lanes.filter((lane) => lane.kind === "task");
      const phases = lanes.filter((lane) => lane.kind === "phase");
      const milestones = lanes.filter((lane) => lane.kind === "milestone");
      const done = showProgress ? bars.filter((lane) => (lane.progress ?? 0) > 0) : [];
      const laneDelay = (lane: Lane | undefined, index: number): number => delayOf(lane?.index ?? index);
      const colorOf = (lane: Lane): string => lane.color;
      const doneEnd = (l: Lane): number => l.start.getTime() + (l.end.getTime() - l.start.getTime()) * (l.progress ?? 0);
      const marks: LaneMark[] = [];
      const copies: LaneMark[] = [];
      const dims: string[] = [];
      const late: string[] = [];
      const milestoneFills: [string, string][] = [];
      if (tasks !== undefined) {
        const phaseSize = Math.max(4, thickness * 0.32);
        const phase = (id: string, motion: boolean) =>
          barX(phases, { id, y: laneValue, x1: (l) => l.start.getTime(), x2: (l) => l.end.getTime(), key: keyOfLane, fill: tasks.phaseFill ?? "var(--chart-foreground-muted)", maxThickness: phaseSize, radius: 2, motion: motion ? enterMotion(enter, laneDelay) : false });
        const track = (id: string, motion: boolean) =>
          barX(bars, { id, y: laneValue, x1: (l) => l.start.getTime(), x2: (l) => l.end.getTime(), key: keyOfLane, fill: colorOf, fillOpacity: showProgress ? 0.28 : 1, maxThickness: thickness, radius, motion: motion ? enterMotion(enter, laneDelay) : false });
        const progress = (id: string, motion: boolean) =>
          barX(done, { id, y: laneValue, x1: (l) => l.start.getTime(), x2: doneEnd, key: keyOfLane, fill: colorOf, maxThickness: thickness, radius, motion: motion ? enterMotion(enter, (l, i) => laneDelay(l, i) + enter.durationMs * 0.25) : false });
        marks.push(
          barX(phases, { id: MARK.phaseBg, y: laneValue, x1: () => domain[0].getTime(), x2: () => domain[1].getTime(), key: keyOfLane, fill: "var(--chart-segment-background)", motion: false }),
          phase(MARK.phase, true),
          track(MARK.track, true),
          progress(MARK.progress, true),
        );
        copies.push(focusCopy(phase(`${MARK.phase}-hover`, false)), focusCopy(track(`${MARK.track}-hover`, false)), focusCopy(progress(`${MARK.progress}-hover`, false)));
        dims.push(MARK.phase, MARK.track, MARK.progress);
        for (const color of new Set(milestones.map(colorOf))) {
          const id = `${MARK.milestone}-${milestoneFills.length}`;
          milestoneFills.push([id, color], [`${id}-hover`, color]);
          const diamond = (markId: string): LaneMark =>
            erase(link(milestones.filter((lane) => lane.color === color), { id: markId, x1: (l) => l.start, x2: (l) => l.start, y1: laneValue, y2: laneValue, key: keyOfLane, stroke: color, strokeWidth: 1.5, curve: diamondCurve(Math.max(5, thickness * 0.42)), motion: false }));
          marks.push(diamond(id));
          copies.push(focusCopy(diamond(`${id}-hover`)));
          dims.push(id);
          late.push(id);
        }
      }
      if (deps.length > 0) {
        const stroke = depsProps?.stroke ?? "var(--chart-foreground-muted)";
        const strokeWidth = depsProps?.strokeWidth ?? 1.25;
        // `links[i]` is row `i`'s link: the base mark's rows are the links themselves, a hover copy's rows the task at either end (the
        // datum `match: "key"` compares with the focused row's), so hovering either task lights the link.
        const connector = (id: string, rows: readonly unknown[], links: readonly Dependency[], color: string, width: number, insets: Insets): LaneMark => {
          const at = (index: number): Dependency => links[index] ?? (links[0] as Dependency);
          return erase(link(rows, {
            id,
            x1: (_d, { index }) => at(index).from.end,
            y1: (_d, { index }) => laneValue(at(index).from),
            x2: (_d, { index }) => at(index).to.start,
            y2: (_d, { index }) => laneValue(at(index).to),
            key: (_d, { index }) => `a${at(index).from.index}_${at(index).to.index}_${index}`,
            stroke: color,
            strokeWidth: width,
            curve: elbowCurve(rowHeight, insets),
            motion: false,
          }));
        };
        // At a milestone the arrow leaves from, or stops at, the diamond's corner: links are grouped by which ends are milestones, a mark
        // per group (a curve sees only the points).
        const diamond = Math.max(5, thickness * 0.42);
        const isMilestone = (lane: Lane): boolean => lane.kind === "milestone";
        const groupOf = (dep: Dependency): string => `${isMilestone(dep.from) ? "m" : "t"}${isMilestone(dep.to) ? "m" : "t"}`;
        for (const group of ["tt", "tm", "mt", "mm"]) {
          const rows = deps.filter((dep) => groupOf(dep) === group);
          if (rows.length === 0) {
            continue;
          }
          const [fromKind, toKind] = group;
          const insets = { start: fromKind === "m" ? diamond : 0, end: toKind === "m" ? diamond : 0 };
          const id = group === "tt" ? MARK.deps : `${MARK.deps}-${group}`;
          marks.push(connector(id, rows, rows, stroke, strokeWidth, insets));
          dims.push(id);
          late.push(id);
          const ends: DependencyEnd[] = rows.flatMap((dep) => [{ lane: dep.from, dep }, { lane: dep.to, dep }]);
          copies.push(focusCopy(connector(`${id}-hover`, ends.map((end) => end.lane), ends.map((end) => end.dep), "var(--chart-foreground)", strokeWidth + 0.25, insets)));
        }
      }
      if (yAxis !== undefined) {
        const label = (id: string, rows: readonly Lane[], color: string, weight: number): LaneMark =>
          erase(text(rows, { id, x: () => domain[0], y: laneValue, text: (l) => l.name, key: keyOfLane, fill: color, fontSize: 12, fontWeight: weight, anchor: "start", dx: (l) => -labelWidth + (l.nested ? 16 : 4), motion: false }));
        const phaseRows = lanes.filter((lane) => lane.kind === "phase");
        const taskRows = lanes.filter((lane) => lane.kind !== "phase");
        marks.push(label(MARK.labels, taskRows, "var(--chart-label)", 400), label(MARK.phaseLabels, phaseRows, "var(--chart-foreground)", 600));
        copies.push(focusCopy(label(`${MARK.labels}-hover`, taskRows, "var(--chart-foreground)", 400)), focusCopy(label(`${MARK.phaseLabels}-hover`, phaseRows, "var(--chart-foreground)", 600)));
        dims.push(MARK.labels, MARK.phaseLabels);
      }
      if (todayDate !== undefined && finiteTime(todayDate)) {
        const stroke = today?.stroke ?? "var(--chart-date-pill-background)";
        marks.push(erase(ruleX([todayDate], { id: MARK.today, x: (d) => d, stroke, strokeWidth: 1.25, strokeDasharray: "4 4", motion: false })));
        late.push(MARK.today);
        if (todayLabel !== "" && lanes.length > 0) {
          const last = String(lanes.length - 1);
          marks.push(erase(text([todayDate], { id: MARK.todayLabel, x: (d) => d, y: () => last, text: () => todayLabel, fill: stroke, fontSize: 11, fontWeight: 600, anchor: "middle", dy: rowHeight / 2 + 16, motion: false })));
          late.push(MARK.todayLabel);
        }
      }
      // The focus targets: one invisible point per row at its end (the tooltip sits beside it).
      const hitMark: LaneMark = erase(dot(lanes, { id: MARK.hit, x: (l) => l.end, y: laneValue, key: keyOfLane, r: 1, fillOpacity: 0, motion: false }));
      const laneSet = new Set<unknown>(lanes);
      const laneFocus = {
        ...focusNearestY,
        resolve: (points: readonly ChartPoint[], context: { readonly x: number; readonly y: number }): ChartPoint[] => {
          const index = Math.floor((context.y - margin.top) / rowHeight);
          if (index < 0 || index >= lanes.length || context.x < 0) {
            return [];
          }
          const hit = points.find((p) => p.markId === MARK.hit && laneSet.has(p.datum) && (p.datum as Lane).index === index);
          return hit === undefined ? [] : [hit];
        },
        group: (_points: readonly ChartPoint[], context: { readonly point: ChartPoint }): ChartPoint[] => [context.point],
        navigation: (points: readonly ChartPoint[]): ChartPoint[] =>
          points.filter((p) => p.markId === MARK.hit && laneSet.has(p.datum)).toSorted((a, b) => (a.datum as Lane).index - (b.datum as Lane).index),
      };
      const xFormat = xAxis?.formatValue ?? ((d: Date): string => shortDateFmt.format(d));
      // A placeholder with no tasks yet takes its height from the skeleton's rows.
      const loading = props.status === "loading";
      const rows = lanes.length > 0 ? lanes.length : loading ? SKELETON_ROWS : 1;
      const height = margin.top + margin.bottom + rows * rowHeight;
      const definition = defineChart(erase({
        chart: ({ width, height: h }: { readonly width: number; readonly height: number }) => {
          size.set(width, h);
          return {
            marks: [...marks, ...copies, hitMark],
            scales: {
              x: {
                scale: scaleTime().domain(domain),
                side: axisTop ? "top" : "bottom",
                grid: scaleGrid(grid === undefined ? undefined : { ...grid, vertical: grid.vertical ?? true }, "x"),
                axis: xAxis === undefined ? false : { line: false, ticks: { count: xAxis.numTicks ?? 6, size: 0, padding: 10, format: xFormat }, tickLabels: TICK_LABELS },
              },
              y: { scale: scaleBand<string>().domain(categoryDomain(lanes.length)).paddingInner(0).paddingOuter(0), grid: false, axis: false },
            },
            margin,
            theme: bklitTheme,
          };
        },
        focus: laneFocus,
        maxFocusDistance: Number.POSITIVE_INFINITY,
        focusRing: false,
        tooltip: plotTooltip(tooltipProps, "point", {}),
      }));
      const items: PlotItem[] = lanes.map((lane) => ({ datum: lane.row, index: lane.dataIndex, title: lane.name, rows: laneRows(lane) }));
      const reveal = enter.animate ? enter.durationMs : 0;
      const css = [
        hoverDimCss(scope, dims.map((id) => (id.startsWith(MARK.deps) ? { id, dim: 0.18 } : { id })), tasks?.fadedOpacity),
        // A milestone's diamond is a link path (no fill): filled with its colour.
        ...milestoneFills.map(([id, color]) => `${scope} path[data-ts-key^="${id}:"]{fill:${color}}`),
        reveal > 0 ? PLOT_FADE_KEYFRAMES : "",
        reveal > 0 ? lateFadeCss(scope, late.filter((id) => id.startsWith(MARK.milestone)), reveal * 0.55, 300) : "",
        reveal > 0 ? lateFadeCss(scope, late.filter((id) => id === MARK.today || id === MARK.todayLabel), reveal * 0.4) : "",
        reveal > 0 ? lateFadeCss(scope, late.filter((id) => id.startsWith(MARK.deps)), reveal * 0.8) : "",
      ].join("");
      return {
        definition,
        items,
        itemOf: (datum) => (laneSet.has(datum) ? (datum as Lane).index : -1),
        margin,
        box: { height, minWidth: props.minWidth },
        describe: () => describeGantt(props.data, table),
        ariaLabel: props.ariaLabel ?? "Gantt chart",
        ariaDescription: props.ariaDescription,
        css,
        chrome: null,
        skeleton: ganttSkeleton({
          kinds: lanes.length > 0 ? lanes.map((lane) => lane.kind) : Array.from({ length: SKELETON_ROWS }, () => "task" as const),
          nested: lanes.map((lane) => lane.nested),
          rowHeight,
          thickness,
          radius,
          labelWidth,
        }),
      };
    });
  };
}

/** The Gantt family on the shared plot controller (core/plot/controller.ts). */
export const ganttFamily = (): PlotFamily<GanttProps> => ({ chart: "gantt", build: createGanttBuilder() });
