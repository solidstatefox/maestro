type Length = string | number;

/** A color stop of a gradient. */
export interface GradientStop {
  /** Position along the gradient from 0 to 1. */
  readonly offset: number;
  /** Color at that position. */
  readonly color: string;
}

export interface GradientOwnProps<Node> {
  /** Id of the gradient, referenced as `url(#id)`. */
  readonly id: string;
  /**
   * Color at the start of the gradient.
   * @default "currentColor"
   */
  readonly from?: string;
  /**
   * Color at the end of the gradient.
   * @default "currentColor"
   */
  readonly to?: string;
  /**
   * Position of the start color, as a fraction (`0.2`) or a percentage (`"20%"`).
   * @default 0
   */
  readonly fromOffset?: Length;
  /**
   * Position of the end color, as a fraction or a percentage.
   * @default 1
   */
  readonly toOffset?: Length;
  /**
   * Opacity of the start color from 0 to 1.
   * @default 1
   */
  readonly fromOpacity?: Length;
  /**
   * Opacity of the end color from 0 to 1.
   * @default 1
   */
  readonly toOpacity?: Length;
  /** Rotates the gradient direction by this many degrees. */
  readonly rotate?: number | string;
  /** An SVG transform string. Only `rotate(angle)` is applied, and it takes precedence over `rotate`. */
  readonly transform?: string;
  /** `<stop>` elements. When present they replace `from` and `to`. */
  readonly children?: Node;
}

export interface LinearGradientOwnProps<Node> extends GradientOwnProps<Node> {
  /**
   * Start x of the gradient vector, as a fraction or a percentage.
   * @default 0
   */
  readonly x1?: Length;
  /**
   * Start y of the gradient vector.
   * @default 0
   */
  readonly y1?: Length;
  /**
   * End x of the gradient vector.
   * @default 1
   */
  readonly x2?: Length;
  /**
   * End y of the gradient vector.
   * @default 0
   */
  readonly y2?: Length;
  /**
   * Run the gradient from top to bottom. Ignored when any of `x1`, `y1`, `x2`, `y2` is set to a non-zero value.
   * @default true
   */
  readonly vertical?: boolean;
}

export interface RadialGradientOwnProps<Node> extends GradientOwnProps<Node> {
  /**
   * Center x of the outer circle, as a fraction or a percentage.
   * @default 0.5
   */
  readonly cx?: Length;
  /**
   * Center y of the outer circle.
   * @default 0.5
   */
  readonly cy?: Length;
  /**
   * Radius of the outer circle.
   * @default 0.5
   */
  readonly r?: Length;
  /** Focal point x. The focal point is the center when omitted. */
  readonly fx?: Length;
  /** Focal point y. The focal point is the center when omitted. */
  readonly fy?: Length;
}
