import { parseFctQuerySnapshot, serializeFctQuerySnapshot, snapshotFctQueryXml, type FctXmlNode } from "./fct-query-clone";

/** A derived Status query is a detached data-plane XML projection. */
function statusViewProjection(liveQueryXml: string, type: "list-status" | "ask", statusAddr?: string): string {
  if (!liveQueryXml || liveQueryXml.length > 100_000) {
    throw new Error("The live FCT query is unavailable or too large.");
  }
  const nodes = parseFctQuerySnapshot(snapshotFctQueryXml(liveQueryXml, "data"));
  let views = 0;
  const walk = (entries: FctXmlNode[]): void => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const node = entries[i];
      const name = Object.keys(node).find(key => key !== ":@" && key !== "#text" && !key.startsWith("?"));
      if (name && name.split(":").at(-1) === "status") {
        entries.splice(i, 1);
        continue;
      }
      if (name && name.split(":").at(-1) === "view") {
        views++;
        node[":@"] = { "@_type": type };
        node[name] = [];
        if (type === "ask" && statusAddr) {
          const prefix = name.includes(":") ? `${name.slice(0,name.lastIndexOf(":"))}:` : "";
          entries.splice(i, 0, { [`${prefix}status`]: [], ":@": { "@_addr": statusAddr } });
        }
      } else if (name && Array.isArray(node[name])) walk(node[name] as FctXmlNode[]);
    }
  };
  walk(nodes);
  if (views !== 1) throw new Error("Status requires exactly one view on the FCT query snapshot.");
  return serializeFctQuerySnapshot(nodes);
}
export function cloneFctListStatusView(liveQueryXml: string): string {
  return statusViewProjection(liveQueryXml, "list-status");
}
export function cloneFctStatusAskView(liveQueryXml: string, personalAddress: string): string {
  return statusViewProjection(liveQueryXml, "ask", personalAddress);
}
