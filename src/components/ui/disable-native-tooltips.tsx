"use client";

import { useEffect } from "react";

/** Remove only browser-native title tooltips. Existing shadcn/Base UI tooltip
 * triggers are left entirely alone: no synthetic trigger, mouse event listener,
 * cursor manipulation or duplicate overlay. */
export function DisableNativeTooltips() {
  useEffect(() => {
    const strip = (root: Element) => {
      if (root.hasAttribute("title")) root.removeAttribute("title");
      for (const element of root.querySelectorAll("[title]")) element.removeAttribute("title");
    };
    strip(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) {
          record.target.removeAttribute("title");
        } else {
          for (const node of record.addedNodes) if (node instanceof Element) strip(node);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    return () => observer.disconnect();
  }, []);
  return null;
}
