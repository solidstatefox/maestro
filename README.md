# Maestro XState Phase B — TypeScript build fix

**Baseline:** `maestro-xstate-ui-phase-b-access-gates.zip`. Extract into your Maestro project root; only `src/lib/app-lifecycle/access.ts` is changed.

## Why this fixes TS2322

A reusable `assign()` action was created outside `setup().createMachine()` with `event: AccessEvent`. XState inferred the action's event type as the general `EventObject`, which is not assignable to the narrower `SESSION_OBSERVED` transition.

The shared code is now a **pure context updater** accepting the `SESSION_OBSERVED` event, and each transition creates its own `assign()` inline. XState can infer the narrowed event from the machine configuration, preserving the exact access gates and session/bookmark behavior without casts or `any`.

## Verify (PowerShell)

```powershell
npm.cmd run build
node --import tsx --test tests/app-lifecycle-phase-a.test.ts tests/app-lifecycle-phase-b.test.ts
```

The file was syntax-checked here. An integrated Next.js typecheck and runtime tests must run in your installed project.
