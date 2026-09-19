import type { Vec2 } from '@interior/core';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export type PlanTool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'pan' | 'measure';

export interface MeasureState {
  from: Vec2 | null;
  to: Vec2 | null;
  active: boolean;
}