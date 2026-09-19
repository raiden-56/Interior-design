import type { UnitSystem } from './types';

/**
 * The canonical model stores lengths in METERS. This module converts
 * meters -> display units and parses user input back to meters.
 */

export const M_PER_FOOT = 0.3048;

export function toMeters(value: number, unit: UnitSystem): number {
  switch (unit) {
    case 'centimeters':
      return value / 100;
    case 'feet':
      return value * M_PER_FOOT;
    default:
      return value;
  }
}

export function fromMeters(meters: number, unit: UnitSystem): number {
  switch (unit) {
    case 'centimeters':
      return meters * 100;
    case 'feet':
      return meters / M_PER_FOOT;
    default:
      return meters;
  }
}

export function formatLength(meters: number, unit: UnitSystem, digits = 2): string {
  const v = fromMeters(meters, unit);
  const fixed = v.toFixed(digits);
  const label = unit === 'meters' ? 'm' : unit === 'centimeters' ? 'cm' : 'ft';
  return `${fixed} ${label}`;
}

export function formatArea(m2: number, unit: UnitSystem): string {
  if (unit === 'feet') {
    return `${(m2 / (M_PER_FOOT * M_PER_FOOT)).toFixed(1)} sq ft`;
  }
  if (unit === 'centimeters') {
    return `${(m2 * 10000).toFixed(0)} cm²`;
  }
  return `${m2.toFixed(2)} m²`;
}

/** Default grid step in meters for a unit system. */
export function gridStep(unit: UnitSystem): number {
  switch (unit) {
    case 'feet':
      return M_PER_FOOT / 2;
    case 'centimeters':
      return 0.1;
    default:
      return 0.25;
  }
}

export const UNIT_LABELS: Record<UnitSystem, string> = {
  meters: 'Meters (m)',
  centimeters: 'Centimeters (cm)',
  feet: 'Feet (ft)',
};