let counter = 0;

/** Collision-safe, reasonably unique id. */
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 0xffffff;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}${counter.toString(36)}`;
}