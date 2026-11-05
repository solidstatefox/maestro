/** Discrete thinking budgets supported by the Maestro model-selector control. */
export const QWEN_THINKING_BUDGETS = [0, 512, 1024, 4096, 8192] as const;
export type QwenThinkingBudget = (typeof QWEN_THINKING_BUDGETS)[number];

export function parseQwenThinkingBudget(value: unknown): QwenThinkingBudget {
  return typeof value === "number" && QWEN_THINKING_BUDGETS.some((candidate) => candidate === value)
    ? value as QwenThinkingBudget
    : 0;
}

/** Non-standard Qwen options; IteraCompute must forward them to take effect. */
export function qwenThinkingOptions(budget: QwenThinkingBudget, answerTokens: number) {
  return budget === 0
    ? { reasoning: false, enable_thinking: false, max_tokens: answerTokens }
    : { reasoning: true, enable_thinking: true, thinking_budget: budget, max_tokens: budget + answerTokens };
}
