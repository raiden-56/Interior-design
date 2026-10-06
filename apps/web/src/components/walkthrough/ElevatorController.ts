/**
 * A simulated lift.
 *
 * The cabin does not physically travel the shaft: the doors close, the
 * player's height is eased to the destination floor over a realistic
 * duration, and the doors open. The controller is a plain state machine, so a
 * real moving car (a cabin mesh and shaft cut-outs) can be substituted later
 * by driving the same phases from the same ride() call.
 */

export type ElevatorPhase = 'idle' | 'closing' | 'moving' | 'opening';

export interface Ride {
  objectId: string;
  fromY: number;
  toY: number;
  toFloorId: string;
  /** Destination x/z (a lift on the destination floor, or the same spot). */
  x: number;
  z: number;
}

export const ELEVATOR_DOOR_SECONDS = 0.9;
export const ELEVATOR_SPEED = 1.1; // m/s
export const ELEVATOR_MIN_TRAVEL_SECONDS = 1.2;
export const ELEVATOR_APPROACH_RADIUS = 1.4;

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class ElevatorController {
  phase: ElevatorPhase = 'idle';
  ride: Ride | null = null;
  /** 0 = closed, 1 = open; per cabin object id. */
  private doorOpen = new Map<string, number>();
  private t = 0;
  private travelSeconds = 1;

  get riding(): boolean {
    return this.phase !== 'idle';
  }

  /** Door opening fraction for a cabin's panels. */
  doorOpenFor(objectId: string): number {
    return this.doorOpen.get(objectId) ?? 0;
  }

  /** The cabin doors block until most of the way open. */
  isBlocking(objectId: string): boolean {
    return this.doorOpenFor(objectId) < 0.6;
  }

  start(ride: Ride): boolean {
    if (this.riding) return false;
    this.ride = ride;
    this.phase = 'closing';
    this.t = 0;
    this.travelSeconds = Math.max(ELEVATOR_MIN_TRAVEL_SECONDS, Math.abs(ride.toY - ride.fromY) / ELEVATOR_SPEED);
    return true;
  }

  /**
   * Advances the ride and the idle door logic. `near` is the cabin the player
   * stands next to, if any — its doors slide open on approach like the
   * automatic house doors.
   */
  update(dt: number, nearCabinId: string | null): { y: number | null; arrived: Ride | null; progress: number } {
    const ride = this.ride;
    // Idle: doors open for whoever stands in front, close behind them.
    if (this.phase === 'idle' || !ride) {
      for (const [id, open] of this.doorOpen) {
        const target = id === nearCabinId ? 1 : 0;
        this.doorOpen.set(id, approach(open, target, dt / ELEVATOR_DOOR_SECONDS));
      }
      if (nearCabinId && !this.doorOpen.has(nearCabinId)) this.doorOpen.set(nearCabinId, Math.min(1, dt / ELEVATOR_DOOR_SECONDS));
      return { y: null, arrived: null, progress: 0 };
    }

    const id = ride.objectId;
    if (this.phase === 'closing') {
      const open = approach(this.doorOpen.get(id) ?? 1, 0, dt / ELEVATOR_DOOR_SECONDS);
      this.doorOpen.set(id, open);
      if (open <= 0) {
        this.phase = 'moving';
        this.t = 0;
      }
      return { y: ride.fromY, arrived: null, progress: 0 };
    }
    if (this.phase === 'moving') {
      this.t = Math.min(1, this.t + dt / this.travelSeconds);
      const y = ride.fromY + (ride.toY - ride.fromY) * easeInOut(this.t);
      if (this.t >= 1) {
        this.phase = 'opening';
        this.doorOpen.set(id, 0);
      }
      return { y, arrived: null, progress: this.t };
    }
    // opening
    const open = approach(this.doorOpen.get(id) ?? 0, 1, dt / ELEVATOR_DOOR_SECONDS);
    this.doorOpen.set(id, open);
    if (open >= 1) {
      this.phase = 'idle';
      const done = ride;
      this.ride = null;
      return { y: ride.toY, arrived: done, progress: 1 };
    }
    return { y: ride.toY, arrived: null, progress: 1 };
  }

  reset(): void {
    this.phase = 'idle';
    this.ride = null;
    this.doorOpen.clear();
  }
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
