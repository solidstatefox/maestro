const pad2 = (n: number): string => String(n).padStart(2, "0");
export const defaultFormatTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
export const defaultFormatValue = (v: number): string => v.toFixed(2);
