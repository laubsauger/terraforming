export type Fields = {
  // Combined RGBA textures for better performance within 4-texture limit
  fields: GPUTexture;      // RGBA: R=soil, G=rock, B=lava, A=unused
  deltas: GPUTexture;      // RGBA: R=Δsoil, G=Δrock, B=Δlava, A=unused

  // Additional textures for other passes
  fieldsOut: GPUTexture;   // For ping-pong operations like thermal repose

  // Canonical height texture (soil + rock combined)
  // This is the single source of truth for terrain height
  height: GPUTexture;

  // Legacy individual textures (for compatibility during transition)
  soil?: GPUTexture;
  rock?: GPUTexture;
  lava?: GPUTexture;
  deltaSoil?: GPUTexture;
  deltaRock?: GPUTexture;
  deltaLava?: GPUTexture;
  soilOut?: GPUTexture;
};

export function createRGBAFieldTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return device.createTexture({
    size: { width: w, height: h },
    format: 'rgba32float',
    usage: GPUTextureUsage.STORAGE_BINDING |
           GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_SRC |
           GPUTextureUsage.COPY_DST,
  });
}

export function createFieldTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return device.createTexture({
    size: { width: w, height: h },
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING |
           GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_SRC |
           GPUTextureUsage.COPY_DST,
  });
}

export function createFields(device: GPUDevice, w: number, h: number): Fields {
  // Create optimized RGBA textures
  const fields = createRGBAFieldTex(device, w, h);
  const deltas = createRGBAFieldTex(device, w, h);
  const fieldsOut = createRGBAFieldTex(device, w, h);

  // Create canonical height texture
  const height = createFieldTex(device, w, h);

  // Also create legacy individual textures for compatibility
  // These can be removed once all shaders are updated
  const soil = createFieldTex(device, w, h);
  const rock = createFieldTex(device, w, h);
  const lava = createFieldTex(device, w, h);
  const deltaSoil = createFieldTex(device, w, h);
  const deltaRock = createFieldTex(device, w, h);
  const deltaLava = createFieldTex(device, w, h);
  const soilOut = createFieldTex(device, w, h);

  return {
    // Primary optimized textures
    fields,
    deltas,
    fieldsOut,
    height,

    // Legacy compatibility
    soil,
    rock,
    lava,
    deltaSoil,
    deltaRock,
    deltaLava,
    soilOut,
  };
}

export const DENSITIES = {
  soil: 1600, // kg/m^3
  rock: 2600,
  lava: 2700,
} as const;