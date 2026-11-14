"use client";
import { useEffect } from "react";
/** Suppresses browser-native title tooltips, including dynamic provider HTML. */
export function DisableNativeTooltips() {
  useEffect(() => {
    const strip = (root: Element) => {
      const elements = root.matches("[title]") ? [root, ...root.querySelectorAll("[title]")] : [...root.querySelectorAll("[title]")];
      for (const element of elements) {
        const label = element.getAttribute("title");
        if (label && !element.hasAttribute("aria-label") && !element.textContent?.trim()) element.setAttribute("aria-label", label);
        element.removeAttribute("title");
      }
    };
    strip(document.body);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) strip(record.target);
        else for (const node of Array.from(record.addedNodes)) if (node instanceof Element) strip(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    return () => observer.disconnect();
  }, []);
  return null;
}
