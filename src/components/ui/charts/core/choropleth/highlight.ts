const SVG_NS = "http://www.w3.org/2000/svg";

interface GeoNode {
  readonly kind: string;
  readonly key: string;
  readonly path?: string;
  readonly style?: Readonly<Record<string, unknown>>;
  readonly children?: readonly GeoNode[];
}

interface Scene {
  readonly nodes: readonly GeoNode[];
}

const indexes = /* @__PURE__ */ new WeakMap<object, Map<string, GeoNode>>();

const nodeIndex = (scene: Scene, prefix: string): Map<string, GeoNode> => {
  let index = indexes.get(scene);
  if (index) {return index;}
  index = new Map();
  const walk = (nodes: readonly GeoNode[]): void => {
    for (const node of nodes) {
      const children = node.kind === "group" ? node.children : undefined;
      if (children) {
        walk(children);
      }
      if (!children && node.key.startsWith(prefix) && node.path !== undefined) {
        index.set(node.key, node);
      }
    }
  };
  walk(scene.nodes);
  indexes.set(scene, index);
  return index;
};

/** The highlight path of one choropleth host: `show` on a focused feature, `hide` off one, `refresh` after each render (a resize moves the path). */
export class FeatureHighlight {
  private node: SVGPathElement | null = null;
  private key: string | null = null;

  private readonly markId: string;
  /** The stage's map layer, read when the path is first drawn. */
  private readonly layer: () => SVGGElement;

  // Fields assigned by hand, not parameter properties: a project's `erasableSyntaxOnly` (Vite's template) refuses those.
  constructor(markId: string, layer: () => SVGGElement) {
    this.markId = markId;
    this.layer = layer;
  }

  private path(): SVGPathElement {
    if (this.node) {return this.node;}
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", "bkm-choro-hl-path");
    path.style.display = "none";
    this.layer().append(path);
    this.node = path;
    return path;
  }

  show(scene: Scene, key: string): void {
    this.key = key;
    this.write(scene);
  }

  hide(): void {
    this.key = null;
    if (this.node) {this.node.style.display = "none";}
  }

  refresh(scene: Scene): void {
    if (this.key !== null) {
      this.write(scene);
    }
  }

  private write(scene: Scene): void {
    const node = this.key === null ? undefined : nodeIndex(scene, `${this.markId}:`).get(this.key);
    const path = this.path();
    if (!node?.path) {
      path.style.display = "none";
      return;
    }
    path.setAttribute("d", node.path);
    const style = node.style ?? {};
    // style, not attributes: presentation attributes do not resolve var().
    path.style.fill = String(style.fill ?? "none");
    path.style.stroke = String(style.stroke ?? "none");
    path.style.strokeWidth = String(style.strokeWidth ?? 1);
    path.style.strokeLinejoin = "round";
    path.style.display = "";
  }
}
