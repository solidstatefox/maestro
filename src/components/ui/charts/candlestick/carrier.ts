"use client";
// Candlestick config-carrier child: renders nothing, CandlestickChart reads its props.
import type { CandlestickProps } from "../core/types/candlestick";
import { defineCarrier } from "../kit/role";

/** The candles of a `CandlestickChart`: a body between open and close and a wick between high and low. It renders nothing itself; place it as a child of the chart. */
export const Candlestick = /* @__PURE__ */ defineCarrier<CandlestickProps>("candlestick", "Candlestick");
