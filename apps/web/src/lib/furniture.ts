/**
 * Furniture catalog. Assets are lightweight metadata; each ProjectObject
 * bakes in its dimensions so instances survive catalog changes.
 *
 * `shape` selects the procedural 3D builder (see three/meshes.ts) and the
 * 2D footprint. Custom GLB uploads can be added by extending this catalog
 * with a `modelUrl` field (loader lives in three/ModelLoader).
 */

export type FurnitureCategory =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'dining'
  | 'office'
  | 'lighting'
  | 'decoration'
  | 'outdoor'
  | 'structure';

export interface FurnitureAsset {
  id: string;
  name: string;
  category: FurnitureCategory;
  shape:
    | 'sofa'
    | 'lsofa'
    | 'armchair'
    | 'recliner'
    | 'coffee-table'
    | 'tv-unit'
    | 'tv'
    | 'shelf'
    | 'cabinet'
    | 'dining-table'
    | 'chair'
    | 'stool'
    | 'bed'
    | 'bunk-bed'
    | 'crib'
    | 'wardrobe'
    | 'nightstand'
    | 'dresser'
    | 'dressing-table'
    | 'desk'
    | 'office-chair'
    | 'round-table'
    | 'floor-lamp'
    | 'table-lamp'
    | 'pendant'
    | 'ceiling-fan'
    | 'plant'
    | 'rug'
    | 'bathtub'
    | 'toilet'
    | 'sink'
    | 'shower'
    | 'mirror'
    | 'water-heater'
    | 'oven'
    | 'microwave'
    | 'refrigerator'
    | 'kitchen-island'
    | 'kitchen-sink'
    | 'hood'
    | 'washing-machine'
    | 'dishwasher'
    | 'shoe-rack'
    | 'pooja-unit'
    | 'curtain'
    | 'ac-split'
    | 'bench'
    | 'ottoman'
    | 'stairs'
    | 'elevator';
  width: number;
  depth: number;
  height: number;
  color: string;
  tags: string[];
  /**
   * Wall- or ceiling-mounted pieces (TV, split AC, fan, mirror, geyser,
   * chimney hood). For these `height` is the height of their *top*, not a
   * floor-standing height, and the 3D builder lifts them off the floor.
   */
  mounted?: boolean;
}

const cat: Record<string, FurnitureCategory> = {
  L: 'living',
  Br: 'bedroom',
  K: 'kitchen',
  Ba: 'bathroom',
  D: 'dining',
  O: 'office',
  Li: 'lighting',
  Dec: 'decoration',
  Out: 'outdoor',
  S: 'structure',
};

export const FURNITURE_CATEGORIES: { id: FurnitureCategory; label: string }[] = [
  { id: 'living', label: 'Living Room' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'bathroom', label: 'Bathroom' },
  { id: 'dining', label: 'Dining' },
  { id: 'office', label: 'Office' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'decoration', label: 'Decoration' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'structure', label: 'Stairs & Lifts' },
];

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Asset id = category + name.
 *
 * The shape used to sit in the middle of the id ("living-sofa-sofa-3-seat"),
 * which nothing ever spelled that way: every template and every AI keyword
 * asked for "living-sofa-3-seat", missed, and silently dropped the item — so
 * the starter templates opened as empty rooms and "add a sofa" did nothing.
 * Deriving the id from the name alone also means re-modelling an asset (a
 * different `shape`) no longer invalidates projects that already use it.
 */
const A = (
  category: FurnitureCategory,
  name: string,
  shape: FurnitureAsset['shape'],
  w: number,
  d: number,
  h: number,
  color: string,
  tags: string[],
  mounted = false,
): FurnitureAsset => ({
  id: `${category}-${slug(name)}`,
  name,
  category,
  shape,
  width: w,
  depth: d,
  height: h,
  color,
  tags,
  ...(mounted ? { mounted: true } : {}),
});

export const FURNITURE_LIBRARY: FurnitureAsset[] = [
  // Living
  A(cat.L, 'Sofa 3-seat', 'sofa', 2.2, 0.95, 0.82, '#6f7482', ['sofa', 'modern']),
  A(cat.L, 'Sofa 2-seat', 'sofa', 1.7, 0.95, 0.82, '#7c8290', ['sofa']),
  A(cat.L, 'L-Shaped Sofa', 'lsofa', 2.6, 2.0, 0.82, '#5b8db8', ['sofa', 'corner']),
  A(cat.L, 'Armchair', 'armchair', 0.9, 0.85, 0.8, '#8a6f61', ['chair', 'lounge']),
  A(cat.L, 'Recliner', 'recliner', 0.95, 1.0, 1.05, '#7a5f55', ['chair', 'lounge', 'recliner']),
  A(cat.L, 'Ottoman', 'ottoman', 0.7, 0.7, 0.4, '#a08f7a', ['footrest']),
  A(cat.L, 'Coffee Table', 'coffee-table', 1.1, 0.6, 0.42, '#8b6f47', ['table', 'wood']),
  A(cat.L, 'Round Coffee Table', 'round-table', 0.9, 0.9, 0.42, '#9a7b52', ['table', 'wood']),
  A(cat.L, 'TV Unit', 'tv-unit', 1.8, 0.45, 0.5, '#4b4f56', ['tv', 'media']),
  A(cat.L, 'TV Console', 'tv-unit', 2.4, 0.4, 0.55, '#3f434b', ['tv', 'media']),
  A(cat.L, 'Wall TV 55 inch', 'tv', 1.25, 0.09, 1.5, '#15181d', ['tv', 'television', 'screen'], true),
  A(cat.L, 'Bookshelf', 'shelf', 1.2, 0.35, 2.0, '#7a5b3d', ['shelf', 'storage']),
  A(cat.L, 'Media Cabinet', 'cabinet', 1.5, 0.4, 0.6, '#454a52', ['cabinet', 'storage']),
  A(cat.L, 'Shoe Rack', 'shoe-rack', 0.9, 0.35, 0.85, '#8a6a47', ['storage', 'entry', 'shoes']),
  A(cat.L, 'Rug', 'rug', 2.4, 1.6, 0.03, '#8f8577', ['rug', 'floor']),
  A(cat.L, 'Floor Plant', 'plant', 0.5, 0.5, 1.5, '#3f7d4c', ['plant', 'green']),
  A(cat.L, 'Split AC', 'ac-split', 0.92, 0.22, 2.45, '#eef1f4', ['ac', 'air conditioner', 'cooling'], true),
  A(cat.L, 'Ceiling Fan', 'ceiling-fan', 1.3, 1.3, 2.85, '#d5d8dc', ['fan', 'ceiling'], true),

  // Bedroom
  A(cat.Br, 'Queen Bed', 'bed', 1.6, 2.1, 0.9, '#d8cfc2', ['bed']),
  A(cat.Br, 'King Bed', 'bed', 1.9, 2.1, 0.9, '#cfc4b4', ['bed']),
  A(cat.Br, 'Single Bed', 'bed', 0.95, 1.95, 0.85, '#d2c9bb', ['bed', 'single']),
  A(cat.Br, 'Bunk Bed', 'bunk-bed', 1.0, 1.95, 1.72, '#9a7b52', ['bed', 'kids', 'bunk']),
  A(cat.Br, 'Baby Crib', 'crib', 0.72, 1.3, 0.95, '#e0d6c6', ['bed', 'kids', 'crib']),
  A(cat.Br, 'Nightstand', 'nightstand', 0.5, 0.45, 0.55, '#7a5b3d', ['table', 'night']),
  A(cat.Br, 'Wardrobe', 'wardrobe', 1.8, 0.62, 2.1, '#8a6a47', ['storage', 'closet']),
  A(cat.Br, 'Sliding Wardrobe', 'wardrobe', 2.4, 0.65, 2.3, '#7e6a4a', ['storage', 'closet', 'sliding']),
  A(cat.Br, 'Dresser', 'dresser', 1.2, 0.5, 0.9, '#8a6a47', ['storage', 'drawers']),
  A(cat.Br, 'Dressing Table', 'dressing-table', 1.0, 0.45, 1.7, '#9a7b52', ['mirror', 'vanity', 'dressing']),
  A(cat.Br, 'Study Table', 'desk', 1.2, 0.6, 0.75, '#7c5232', ['desk', 'study', 'work']),
  A(cat.Br, 'Bedside Lamp', 'table-lamp', 0.3, 0.3, 0.5, '#e8e3d8', ['lamp', 'light']),

  // Kitchen
  A(cat.K, 'Refrigerator', 'refrigerator', 0.75, 0.7, 1.85, '#c9ccd1', ['fridge', 'appliance']),
  A(cat.K, 'Double-door Fridge', 'refrigerator', 0.92, 0.75, 1.9, '#b6bcc4', ['fridge', 'appliance']),
  A(cat.K, 'Oven Range', 'oven', 0.6, 0.6, 0.9, '#3a3d42', ['oven', 'cooking', 'stove']),
  A(cat.K, 'Microwave', 'microwave', 0.5, 0.38, 0.3, '#33363b', ['microwave', 'appliance']),
  A(cat.K, 'Dishwasher', 'dishwasher', 0.6, 0.6, 0.85, '#c3c8ce', ['dishwasher', 'appliance']),
  A(cat.K, 'Washing Machine', 'washing-machine', 0.6, 0.62, 0.85, '#e3e7ea', ['washing machine', 'washer', 'laundry', 'appliance']),
  A(cat.K, 'Kitchen Sink', 'kitchen-sink', 0.85, 0.6, 0.9, '#b9c0c7', ['sink', 'wash', 'counter']),
  A(cat.K, 'Chimney Hood', 'hood', 0.9, 0.5, 2.0, '#8f979e', ['chimney', 'hood', 'exhaust'], true),
  A(cat.K, 'Kitchen Island', 'kitchen-island', 1.8, 1.0, 0.95, '#9a7b52', ['counter', 'work']),
  A(cat.K, 'Kitchen Cabinet', 'cabinet', 1.2, 0.6, 0.75, '#b3a58c', ['storage', 'counter']),
  A(cat.K, 'Tall Pantry Unit', 'cabinet', 0.6, 0.6, 2.1, '#a89a82', ['storage', 'pantry']),
  A(cat.K, 'Bar Stool', 'stool', 0.45, 0.45, 0.75, '#4b4f56', ['seat']),

  // Bathroom
  A(cat.Ba, 'Bathtub', 'bathtub', 1.7, 0.75, 0.6, '#dfe5ea', ['bath', 'tub']),
  A(cat.Ba, 'Toilet', 'toilet', 0.4, 0.65, 0.75, '#dbe1e6', ['toilet', 'sanitary', 'wc']),
  A(cat.Ba, 'Basin Sink', 'sink', 0.6, 0.5, 0.85, '#dbe1e6', ['sink', 'wash', 'basin']),
  A(cat.Ba, 'Vanity Unit', 'cabinet', 1.0, 0.5, 0.85, '#7f8a93', ['storage', 'basin', 'vanity']),
  A(cat.Ba, 'Shower', 'shower', 0.9, 0.9, 2.1, '#c6d2da', ['shower', 'glass']),
  A(cat.Ba, 'Mirror', 'mirror', 0.8, 0.05, 1.9, '#cfe0e8', ['mirror'], true),
  A(cat.Ba, 'Water Heater', 'water-heater', 0.45, 0.42, 2.1, '#eceff2', ['geyser', 'heater', 'boiler'], true),

  // Dining
  A(cat.D, 'Dining Table (rect)', 'dining-table', 1.8, 0.9, 0.75, '#8b6f47', ['table', 'dining']),
  A(cat.D, 'Dining Table (round)', 'round-table', 1.2, 1.2, 0.75, '#9a7b52', ['table', 'dining']),
  A(cat.D, 'Dining Table 6-seat', 'dining-table', 2.0, 1.0, 0.75, '#80673f', ['table', 'dining', 'family']),
  A(cat.D, 'Dining Chair', 'chair', 0.48, 0.5, 0.9, '#5b5b60', ['chair', 'seating']),
  A(cat.D, 'Dining Bench', 'bench', 1.4, 0.4, 0.45, '#7a5b3d', ['bench', 'seating']),
  A(cat.D, 'Crockery Unit', 'cabinet', 1.2, 0.45, 1.8, '#8a6a47', ['storage', 'crockery', 'display']),

  // Office
  A(cat.O, 'Desk', 'desk', 1.4, 0.7, 0.75, '#7c5232', ['desk', 'work']),
  A(cat.O, 'Office Chair', 'office-chair', 0.6, 0.6, 1.1, '#2f3338', ['chair', 'office']),
  A(cat.O, 'Filing Cabinet', 'cabinet', 0.5, 0.6, 1.3, '#4b5158', ['storage', 'files']),

  // Lighting
  A(cat.Li, 'Floor Lamp', 'floor-lamp', 0.4, 0.4, 1.6, '#d8cfc2', ['lamp', 'light']),
  A(cat.Li, 'Table Lamp', 'table-lamp', 0.3, 0.3, 0.5, '#e8e3d8', ['lamp', 'light']),
  A(cat.Li, 'Pendant Light', 'pendant', 0.35, 0.35, 2.6, '#d8a24a', ['light', 'hanging'], true),

  // Decoration
  A(cat.Dec, 'Console Table', 'coffee-table', 1.1, 0.35, 0.8, '#9a7b52', ['console', 'entry']),
  A(cat.Dec, 'Side Table', 'round-table', 0.5, 0.5, 0.55, '#a08f7a', ['table']),
  A(cat.Dec, 'Wall Art', 'tv-unit', 1.0, 0.08, 0.75, '#5a4a72', ['art', 'decor']),
  A(cat.Dec, 'Full-length Mirror', 'mirror', 0.6, 0.06, 1.8, '#d5e2e9', ['mirror', 'decor'], true),
  A(cat.Dec, 'Pooja Unit', 'pooja-unit', 0.9, 0.5, 1.9, '#a8762f', ['pooja', 'prayer', 'mandir', 'temple']),
  A(cat.Dec, 'Curtain Panel', 'curtain', 1.8, 0.12, 2.5, '#9c8f7f', ['curtain', 'drape', 'window'], true),

  // Outdoor
  A(cat.Out, 'Outdoor Chair', 'chair', 0.55, 0.55, 0.85, '#7d8a63', ['patio', 'seating']),
  A(cat.Out, 'Outdoor Table', 'round-table', 1.0, 1.0, 0.72, '#5c6b52', ['patio', 'table']),
  A(cat.Out, 'Outdoor Sofa', 'sofa', 2.0, 0.9, 0.7, '#4a5544', ['patio', 'sofa']),
  A(cat.Out, 'Potted Tree', 'plant', 0.8, 0.8, 2.0, '#2e5d39', ['plant', 'tree']),

  // Structure — walkable in the walkthrough. A staircase's `height` is its
  // total rise (match the floor height); its front edge (+depth) is the
  // bottom step and it climbs towards its back edge.
  A(cat.S, 'Straight Staircase', 'stairs', 1.0, 3.2, 3.0, '#9a7b52', ['stairs', 'staircase', 'steps', 'floor']),
  A(cat.S, 'Wide Staircase', 'stairs', 1.4, 3.6, 3.0, '#8a6a47', ['stairs', 'staircase', 'steps', 'floor']),
  A(cat.S, 'Elevator', 'elevator', 1.6, 1.8, 2.4, '#aab0b6', ['elevator', 'lift', 'floor']),
];

export const assetById = (id: string): FurnitureAsset | undefined => FURNITURE_LIBRARY.find((a) => a.id === id);

export const searchAssets = (query: string, category: FurnitureCategory | null): FurnitureAsset[] => {
  const q = query.trim().toLowerCase();
  return FURNITURE_LIBRARY.filter((a) => {
    if (category && a.category !== category) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.tags.some((t) => t.includes(q)) ||
      a.category.toLowerCase().includes(q)
    );
  });
};

/** Map a few natural-language tokens -> asset ids, used by the AI engine. */
export const keywordToAssets: Record<string, string[]> = {
  sofa: ['living-sofa-3-seat', 'living-l-shaped-sofa'],
  couch: ['living-sofa-3-seat', 'living-l-shaped-sofa'],
  chair: ['dining-dining-chair', 'living-armchair'],
  table: ['living-coffee-table', 'dining-dining-table-rect'],
  'coffee table': ['living-coffee-table'],
  'dining table': ['dining-dining-table-rect', 'dining-dining-table-6-seat'],
  bed: ['bedroom-queen-bed', 'bedroom-king-bed'],
  'single bed': ['bedroom-single-bed'],
  'bunk bed': ['bedroom-bunk-bed'],
  crib: ['bedroom-baby-crib'],
  wardrobe: ['bedroom-wardrobe', 'bedroom-sliding-wardrobe'],
  lamp: ['lighting-floor-lamp', 'lighting-table-lamp'],
  plant: ['living-floor-plant', 'outdoor-potted-tree'],
  'tv unit': ['living-tv-unit'],
  tv: ['living-wall-tv-55-inch', 'living-tv-unit'],
  television: ['living-wall-tv-55-inch'],
  bookshelf: ['living-bookshelf'],
  rug: ['living-rug'],
  desk: ['office-desk', 'bedroom-study-table'],
  'study table': ['bedroom-study-table'],
  'office chair': ['office-office-chair'],
  fridge: ['kitchen-refrigerator', 'kitchen-double-door-fridge'],
  refrigerator: ['kitchen-refrigerator'],
  'washing machine': ['kitchen-washing-machine'],
  washer: ['kitchen-washing-machine'],
  laundry: ['kitchen-washing-machine'],
  dishwasher: ['kitchen-dishwasher'],
  microwave: ['kitchen-microwave'],
  chimney: ['kitchen-chimney-hood'],
  'kitchen sink': ['kitchen-kitchen-sink'],
  sink: ['bathroom-basin-sink', 'kitchen-kitchen-sink'],
  toilet: ['bathroom-toilet'],
  bathtub: ['bathroom-bathtub'],
  shower: ['bathroom-shower'],
  mirror: ['bathroom-mirror', 'decoration-full-length-mirror'],
  geyser: ['bathroom-water-heater'],
  'water heater': ['bathroom-water-heater'],
  oven: ['kitchen-oven-range'],
  stove: ['kitchen-oven-range'],
  stool: ['kitchen-bar-stool'],
  nightstand: ['bedroom-nightstand'],
  ottoman: ['living-ottoman'],
  'arm chair': ['living-armchair'],
  armchair: ['living-armchair'],
  recliner: ['living-recliner'],
  ac: ['living-split-ac'],
  'air conditioner': ['living-split-ac'],
  fan: ['living-ceiling-fan'],
  'ceiling fan': ['living-ceiling-fan'],
  curtain: ['decoration-curtain-panel'],
  pooja: ['decoration-pooja-unit'],
  mandir: ['decoration-pooja-unit'],
  'shoe rack': ['living-shoe-rack'],
  kitchen: ['kitchen-kitchen-island', 'kitchen-kitchen-cabinet'],
  stairs: ['structure-straight-staircase'],
  staircase: ['structure-straight-staircase'],
  elevator: ['structure-elevator'],
  lift: ['structure-elevator'],
};
