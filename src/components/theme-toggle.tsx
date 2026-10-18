"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <label htmlFor="maestro-theme" className="whitespace-nowrap text-xs text-muted-foreground">
        Theme
      </label>
      <select
        id="maestro-theme"
        aria-label="Color theme"
        value={mounted ? (theme ?? "system") : "system"}
        onChange={(event) => setTheme(event.currentTarget.value)}
        className="rounded-sm bg-background text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </div>
  );
}
