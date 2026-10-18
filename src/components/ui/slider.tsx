import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

/** Compact shadcn-style Radix slider. Radix Slider values are arrays. */
export function Slider({ className = "", ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={`relative flex w-full touch-none select-none items-center ${className}`}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb data-slot="slider-thumb" className="block size-3.5 rounded-full border border-primary/50 bg-background shadow-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
}
