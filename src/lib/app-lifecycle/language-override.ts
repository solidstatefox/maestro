import { setup, createActor } from "xstate";
import { validMaestroLanguage } from "@/lib/maestro-language";
/** XState coordinates URL language transitions, not committed FCT/query state.
 * The address bar is re-read after every transition; no language is persisted here. */
export const languageOverrideMachine = setup({
  types: { events: {} as { type: "SET"; language: string } | { type: "REMOVE" } | { type: "RESTORE"; language: string | null } },
  guards: { valid: ({ event }) => event.type === "SET" && !!validMaestroLanguage(event.language) },
}).createMachine({
  id: "maestro-url-language",
  initial: "inactive",
  states: {
    inactive: { on: { SET: { guard: "valid", target: "active" }, RESTORE: [{ guard: ({ event }) => event.type === "RESTORE" && !!validMaestroLanguage(event.language), target: "active" }] } },
    active: { on: { SET: { guard: "valid" }, REMOVE: "inactive", RESTORE: [{ guard: ({ event }) => event.type === "RESTORE" && !validMaestroLanguage(event.language), target: "inactive" }] } },
  },
});
export function createLanguageOverrideActor() {
  const actor = createActor(languageOverrideMachine);
  actor.start();
  return actor;
}
