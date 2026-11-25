"use client";
import { cloneElement, type ReactElement, type ReactNode, type ComponentPropsWithRef } from "react";
import { cn } from "cn";

type TrayButton = ReactElement<ComponentPropsWithRef<"button">>;
/** The icon is the factory's only input. Existing callers complete the button. */
export function facetButtonFactory(icon: ReactNode): TrayButton {
  return <button type="button" data-facet-tray-button="true" className="size-7 shrink-0" style={{width:28,height:28,minWidth:28,minHeight:28,maxWidth:28,maxHeight:28}}>{icon}</button>;
}
/** Preserve caller props and styling, but never override the dimensional contract. */
export function completeFacetButton(button: TrayButton, props: ComponentPropsWithRef<"button">): TrayButton {
  return cloneElement(button,{...props,className:cn(props.className,button.props.className),style:{...props.style,...button.props.style}});
}
