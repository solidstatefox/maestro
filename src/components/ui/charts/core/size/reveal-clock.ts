export interface RevealClock { mountedAt: number | null }

/** Where the reveal-end swap falls on an enter's own clock (ms after `enterAt`): `duration` minus how late the enter began after the timer. */
export const revealEndFromEnter = (clock: RevealClock, enterAt: number | null, duration: number): number =>
  clock.mountedAt === null || enterAt === null ? duration : duration - (enterAt - clock.mountedAt);
