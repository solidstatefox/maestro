/** Native FCT Status projection. The live query, not a separately serialized
 * browser DOM, supplies the graph, path and every selection constraint.
 * Status is a first-class FCT node whose own selected values are excluded
 * from the available-choice counts. This intentionally supports Maestro's
 * serialized, unprefixed, self-closing <view/> FCT grammar.
 */
export function cloneFctListStatusView(liveQueryXml: string): string {
  if (!liveQueryXml || liveQueryXml.length > 100_000)
    throw new Error("The live FCT query is unavailable or too large.");
  const withoutStatus = liveQueryXml.replace(/<status\b[^>]*\/>|<status\b[^>]*>[\s\S]*?<\/status\s*>/g, "");
  let views = 0;
  const cloned = withoutStatus.replace(/<view\b[^>]*\/>/g, () => {
    views++;
    return '<view type="list-status"/>';
  });
  if (views !== 1) throw new Error("Status requires exactly one view on the live FCT query.");
  return cloned;
}
