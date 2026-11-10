/** Shared Browse/Features alphabet selection grammar.
 * A,B,!C = starts with A OR starts with B OR NOT starts with C.
 * Shift-click toggles !letter; plain click toggles letter. */
export function parseAlphabetSelections(index: string): string[] {
  return [...new Set(index.split(",").map((v) => v.trim()).filter((v) => /^!?[A-Z]$/.test(v)))];
}
export function toggleAlphabetSelection(index: string, letter: string, excluded: boolean): string {
  const tokens = parseAlphabetSelections(index);
  const token = `${excluded ? "!" : ""}${letter}`;
  const others = tokens.filter((item) => item !== letter && item !== `!${letter}`);
  if (!tokens.includes(token)) others.push(token);
  return others.join(",");
}
export function matchesAlphabetSelection(index: string, title: string): boolean {
  const terms = parseAlphabetSelections(index);
  if (!terms.length) return true;
  const initial = (title.trim().match(/^[a-z]/i)?.[0] ?? "#").toUpperCase();
  return terms.some((token) => token.startsWith("!") ? initial !== token.slice(1) : initial === token);
}
