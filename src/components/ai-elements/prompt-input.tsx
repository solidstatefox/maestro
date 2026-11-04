"use client";

import * as React from "react";
import { ArrowUp } from "lucide-react";
import { InputGroup, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";

/** AI Elements Prompt Input: Input Group, attachments and native send action. */
export function PromptInput(props: React.ComponentProps<typeof InputGroup>) {
  return <InputGroup {...props} />;
}
export const PromptInputTextarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<typeof InputGroupTextarea>>(
  function PromptInputTextarea(props, ref) {
    return <InputGroupTextarea {...props} ref={ref} />;
  },
);
export function PromptInputSubmit({ children, ...props }: React.ComponentProps<typeof InputGroupButton>) {
  return <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" aria-label="Send" {...props}>
    {children ?? <ArrowUp className="size-4" />}
  </InputGroupButton>;
}
