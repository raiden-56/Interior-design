export * from './id';
export * from './types';
export * from './geometry';
export * from './units';
export * from './snapping';
export * from './collision';
export * from './commands';
export * from './history';

import type { Command } from './commands';
import type { Project } from './types';

/** AI / batch pipelines return this shape so callers can preview + confirm. */
export interface ApplyResult {
  project: Project;
  commands: { command: Command; label: string }[];
  inverseOfBatch: Command;
}

export type { Command, Project };
export type { Floor, Wall, Door, Window, Room, ProjectObject, Vec2, UnitSystem } from './types';