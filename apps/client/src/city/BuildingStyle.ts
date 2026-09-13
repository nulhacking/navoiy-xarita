/** OSM tags are facts; these neutral type palettes are explicitly visual fallbacks. */
export interface BuildingTags {
  id?: number; kind?: string; levels?: number; name?: string;
  colour?: string; material?: string; roofColour?: string; roofShape?: string;
}

export function buildingStyle(tags: BuildingTags) {
  const kind = tags.kind ?? 'yes';
  const palettes: Record<string, { wall: number; roof: number; windowWidth: number }> = {
    house: { wall: 0xd8c9aa, roof: 0x786959, windowWidth: 2.6 },
    apartments: { wall: 0xcbd0cc, roof: 0x6c7479, windowWidth: 3.2 },
    school: { wall: 0xe4d4b0, roof: 0x8e7c6a, windowWidth: 3 },
    kindergarten: { wall: 0xded2bb, roof: 0x809082, windowWidth: 2.7 },
    hospital: { wall: 0xdce4e4, roof: 0x71888c, windowWidth: 3.2 },
    industrial: { wall: 0x9ba5a7, roof: 0x526571, windowWidth: 7 },
    garage: { wall: 0xaaa298, roof: 0x646971, windowWidth: 8 },
    greenhouse: { wall: 0xa7c0b8, roof: 0x8aaca7, windowWidth: 1.3 },
    retail: { wall: 0xcab6a1, roof: 0x716b69, windowWidth: 4.5 },
  };
  const style = palettes[kind] ?? { wall: 0xcac4b7, roof: 0x88877f, windowWidth: 3.4 };
  const variation=Math.abs(Math.imul(tags.id??17,2654435761))%5;
  const residentialWalls=[0xd7cbb6,0xc3c6bf,0xd6d7d1,0xc8bba9,0xc5ccc8];
  const materials: Record<string, number> = { brick: 0xac7561, concrete: 0xbfc0b9, plaster: 0xe0d8c7, metal: 0x9aabb5, wood: 0xa28a66 };
  // Only accept actual supported colour syntax, never inject arbitrary source text into shaders/CSS.
  const colour = (value?: string) => value && /^(#[\da-f]{3}(?:[\da-f]{3})?|white|black|grey|gray|brown|beige|red|green|blue|yellow)$/i.test(value) ? value : undefined;
  const fallbackFacade = Math.abs(Math.imul(tags.id ?? 17,2654435761)) % 3;
  const facade = ['house','detached','bungalow'].includes(kind) ? 1
    : kind === 'apartments' ? 2 : ['retail','commercial','office','supermarket','greenhouse'].includes(kind) ? 3 : fallbackFacade;
  return { ...style, wall: colour(tags.colour) ?? materials[tags.material ?? ''] ?? (['apartments','yes'].includes(kind)?residentialWalls[variation]!:style.wall),
    facade,
    pitchedRoof: ['house','detached','bungalow','cabin'].includes(kind) || ['hipped','pyramidal','gabled'].includes(tags.roofShape ?? ''),
    roof: colour(tags.roofColour) ?? style.roof,
    windows: !['garage', 'garages', 'warehouse', 'industrial', 'barn', 'roof'].includes(kind),
    levels: tags.levels && tags.levels > 0 && tags.levels < 200 ? tags.levels : null };
}
