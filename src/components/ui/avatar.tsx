"use client"

import * as React from "react"
import { cn } from "cn"

type AvatarStatus = "idle" | "loading" | "loaded" | "error"

const AvatarContext = React.createContext<{
  status: AvatarStatus
  setStatus: React.Dispatch<React.SetStateAction<AvatarStatus>>
}>({
  status: "idle",
  setStatus: () => {},
})

interface AvatarProps extends React.ComponentProps<"span"> {
  size?: "default" | "sm" | "lg"
}

function Avatar({
  className,
  size = "default",
  children,
  ...props
}: AvatarProps) {
  const [status, setStatus] = React.useState<AvatarStatus>("idle")

  return (
    <AvatarContext.Provider value={{ status, setStatus }}>
      <span
        data-slot="avatar"
        data-size={size}
        className={cn(
          "group/avatar relative flex shrink-0 select-none items-center justify-center rounded-full ring-1 ring-border/50 transition-all",
          size === "sm" && "size-8 text-xs",
          size === "default" && "size-9 text-sm",
          size === "lg" && "size-10 text-base",
          className
        )}
        {...props}
      >
        {children}
      </span>
    </AvatarContext.Provider>
  )
}

function AvatarImage({
  className,
  src,
  alt,
  onLoad,
  onError,
  ...props
}: React.ComponentProps<"img">) {
  const { status, setStatus } = React.useContext(AvatarContext)

  React.useEffect(() => {
    if (!src) {
      setStatus("error")
      return
    }
    const srcStr = typeof src === "string" ? src : ""
    if (!srcStr) {
      setStatus("error")
      return
    }
    let active = true
    const img = new Image()
    img.src = srcStr
    img.onload = () => {
      if (active) setStatus("loaded")
    }
    img.onerror = () => {
      if (active) setStatus("error")
    }
    return () => {
      active = false
    }
  }, [src, setStatus])

  if (status !== "loaded" || !src) return null

  return (
    <img
      data-slot="avatar-image"
      src={src}
      alt={alt}
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  const { status } = React.useContext(AvatarContext)

  if (status === "loaded") return null

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted font-medium text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full ring-2 ring-background select-none",
        "size-2.5 bg-emerald-500 dark:bg-emerald-400",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn("flex items-center -space-x-2 *:ring-2 *:ring-background", className)}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs ring-2 ring-background",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount }
