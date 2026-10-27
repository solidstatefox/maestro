"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { CheckCircle2, Info, LoaderCircle, TriangleAlert, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const toast = ToastPrimitive.createToastManager();
function ToastProvider(props: React.ComponentProps<typeof ToastPrimitive.Provider>) { return <ToastPrimitive.Provider {...props} />; }
function ToastPortal(props: React.ComponentProps<typeof ToastPrimitive.Portal>) { return <ToastPrimitive.Portal {...props} />; }
function ToastViewport({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
  return <ToastPrimitive.Viewport className={cn("pointer-events-none fixed inset-x-4 bottom-4 z-[100] mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full", className)} {...props} />;
}
function Toast({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Root>) {
  return <ToastPrimitive.Root className={cn("pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom border bg-popover text-popover-foreground shadow-lg outline-none", "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]", "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms] after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-[''] data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-limited:opacity-0 data-starting-style:[transform:translateY(150%)] [&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]", className)} {...props} />;
}
function ToastContent(props: React.ComponentProps<typeof ToastPrimitive.Content>) { return <ToastPrimitive.Content className="flex h-full items-center gap-3 overflow-hidden p-4" {...props} />; }
function ToastTitle(props: React.ComponentProps<typeof ToastPrimitive.Title>) { return <ToastPrimitive.Title className="text-sm font-medium" {...props} />; }
function ToastDescription(props: React.ComponentProps<typeof ToastPrimitive.Description>) { return <ToastPrimitive.Description className="text-sm text-muted-foreground" {...props} />; }
function ToastAction({ className, render = <Button variant="outline" size="sm" />, ...props }: React.ComponentProps<typeof ToastPrimitive.Action>) { return <ToastPrimitive.Action render={render} className={cn("shrink-0", className)} {...props} />; }
function ToastClose({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Close>) { return <ToastPrimitive.Close aria-label="Close notification" render={<Button variant="ghost" size="icon-sm"><X className="size-4" /></Button>} className={cn("relative shrink-0 text-muted-foreground hover:text-foreground", className)} {...props} />; }
function ToastIcon({ type }: { type?: string }) {
  const Icon = type === "success" ? CheckCircle2 : type === "warning" ? TriangleAlert : type === "error" ? XCircle : type === "loading" ? LoaderCircle : type === "info" ? Info : null;
  return Icon ? <Icon aria-hidden="true" className={cn("size-4 shrink-0", type === "error" && "text-destructive", type === "loading" && "animate-spin")} /> : null;
}
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((item) => <Toast key={item.id} toast={item}><ToastContent><ToastIcon type={item.type} /><div className="flex min-w-0 flex-1 flex-col gap-1"><ToastTitle /><ToastDescription /></div><ToastAction /><ToastClose /></ToastContent></Toast>);
}
function Toaster({ children, toastManager = toast, ...props }: React.ComponentProps<typeof ToastPrimitive.Provider>) {
  return <ToastProvider toastManager={toastManager} {...props}>{children}<ToastPortal><ToastViewport><ToastList /></ToastViewport></ToastPortal></ToastProvider>;
}
export { Toaster, toast, Toast, ToastAction, ToastClose, ToastContent, ToastDescription, ToastPortal, ToastProvider, ToastTitle, ToastViewport };
