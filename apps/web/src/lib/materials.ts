export interface Material {
  id: string;
  name: string;
  category: 'paint' | 'wood' | 'stone' | 'metal' | 'fabric' | 'glass' | 'tile';
  color: string;
  /** PBR hints (0..1). */
  roughness: number;
  metalness: number;
  thumbnail?: string;
}

export const MATERIALS: Material[] = [
  // Paint
  { id: 'paint-white', name: 'Matte White', category: 'paint', color: '#f4f4f3', roughness: 0.9, metalness: 0 },
  { id: 'paint-ivory', name: 'Ivory', category: 'paint', color: '#efead8', roughness: 0.9, metalness: 0 },
  { id: 'paint-beige', name: 'Warm Beige', category: 'paint', color: '#d9cbb3', roughness: 0.85, metalness: 0 },
  { id: 'paint-grey', name: 'Warm Grey', category: 'paint', color: '#b4b4ae', roughness: 0.9, metalness: 0 },
  { id: 'paint-greige', name: 'Greige', category: 'paint', color: '#a99f8f', roughness: 0.9, metalness: 0 },
  { id: 'paint-sage', name: 'Sage Green', category: 'paint', color: '#a3ad91', roughness: 0.85, metalness: 0 },
  { id: 'paint-slate-blue', name: 'Slate Blue', category: 'paint', color: '#7e8aa0', roughness: 0.85, metalness: 0 },
  { id: 'paint-charcoal', name: 'Charcoal', category: 'paint', color: '#3c3f44', roughness: 0.9, metalness: 0 },
  { id: 'paint-navy', name: 'Navy', category: 'paint', color: '#2e3c50', roughness: 0.85, metalness: 0 },
  { id: 'paint-blush', name: 'Blush', category: 'paint', color: '#d8b4ac', roughness: 0.9, metalness: 0 },
  { id: 'paint-terra', name: 'Terracotta', category: 'paint', color: '#b96a4b', roughness: 0.85, metalness: 0 },

  // Wood
  { id: 'wood-oak', name: 'Light Oak', category: 'wood', color: '#c8a36a', roughness: 0.5, metalness: 0 },
  { id: 'wood-walnut', name: 'Walnut', category: 'wood', color: '#6f4e37', roughness: 0.5, metalness: 0 },
  { id: 'wood-ash', name: 'Ash', category: 'wood', color: '#d9c6a3', roughness: 0.55, metalness: 0 },
  { id: 'wood-teak', name: 'Teak', category: 'wood', color: '#9a6b3a', roughness: 0.5, metalness: 0 },
  { id: 'wood-dark', name: 'Dark Wood', category: 'wood', color: '#4a3523', roughness: 0.45, metalness: 0 },

  // Stone
  { id: 'stone-marble-white', name: 'White Marble', category: 'stone', color: '#e7e3dc', roughness: 0.25, metalness: 0 },
  { id: 'stone-marble-grey', name: 'Grey Marble', category: 'stone', color: '#9b9d9e', roughness: 0.25, metalness: 0 },
  { id: 'stone-granite', name: 'Granite', category: 'stone', color: '#5c5d60', roughness: 0.2, metalness: 0 },
  { id: 'stone-slate', name: 'Slate', category: 'stone', color: '#3d4247', roughness: 0.6, metalness: 0 },

  // Metal
  { id: 'metal-steel', name: 'Steel', category: 'metal', color: '#aab0b6', roughness: 0.35, metalness: 1 },
  { id: 'metal-brass', name: 'Brass', category: 'metal', color: '#c59f54', roughness: 0.3, metalness: 1 },
  { id: 'metal-black', name: 'Black Metal', category: 'metal', color: '#2a2b2e', roughness: 0.4, metalness: 0.8 },

  // Fabric
  { id: 'fabric-linen', name: 'Linen', category: 'fabric', color: '#d9cfbf', roughness: 1, metalness: 0 },
  { id: 'fabric-grey', name: 'Grey Fabric', category: 'fabric', color: '#8a8d91', roughness: 1, metalness: 0 },
  { id: 'fabric-velvet', name: 'Velvet Blue', category: 'fabric', color: '#3f5f7f', roughness: 0.85, metalness: 0 },
  { id: 'fabric-terracotta', name: 'Terracotta Fabric', category: 'fabric', color: '#ad6b50', roughness: 1, metalness: 0 },

  // Glass
  { id: 'glass-clear', name: 'Clear Glass', category: 'glass', color: '#cfe3ea', roughness: 0.05, metalness: 0 },
  { id: 'glass-frosted', name: 'Frosted Glass', category: 'glass', color: '#dbe9ee', roughness: 0.4, metalness: 0 },

  // Tile
  { id: 'tile-white', name: 'White Tile', category: 'tile', color: '#eef0f1', roughness: 0.3, metalness: 0 },
  { id: 'tile-terra', name: 'Terrazzo', category: 'tile', color: '#cfc6b8', roughness: 0.35, metalness: 0 },
];

export const materialById = (id: string | null): Material | undefined => (id ? MATERIALS.find((m) => m.id === id) : undefined);

export const MATERIAL_CATEGORIES: { id: Material['category']; label: string }[] = [
  { id: 'paint', label: 'Paint' },
  { id: 'wood', label: 'Wood' },
  { id: 'stone', label: 'Stone' },
  { id: 'metal', label: 'Metal' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'glass', label: 'Glass' },
  { id: 'tile', label: 'Tile' },
];

/** A curated list of hex colors used by the color swatches. */
export const SWATCHES: string[] = [
  '#f4f4f3', '#efead8', '#d9cbb3', '#b4b4ae', '#a99f8f', '#a3ad91',
  '#7e8aa0', '#3c3f44', '#2e3c50', '#d8b4ac', '#b96a4b', '#c8a36a',
  '#6f4e37', '#9a6b3a', '#4a3523', '#8a8d91', '#c59f54', '#5c5d60',
];