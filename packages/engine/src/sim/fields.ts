export type Fields = {
  // Material fields
  soil: GPUTexture;
  rock: GPUTexture;
  lava: GPUTexture;
  deltaSoil: GPUTexture;
  deltaRock: GPUTexture;
  deltaLava: GPUTexture;
  // Additional texture for thermal repose ping-pong
  soilOut: GPUTexture;

  // Canonical height texture (soil + rock combined)
  // This is the single source of truth for terrain height
  height: GPUTexture;

  // Fluid simulation fields
  flow: GPUTexture;         // RG32F for u,v velocity components (storage)
  flowOut: GPUTexture;      // Ping-pong buffer for flow (storage)
  flowSampled: GPUTexture;  // Flow texture for sampling (not storage)
  waterDepthSampled: GPUTexture; // Water depth for sampling (not storage)
  waterDepth: GPUTexture;   // R16F water depth
  waterDepthOut: GPUTexture; // Ping-pong buffer for water
  flowAccumulation: GPUTexture; // R32F for flow accumulation
  poolMask: GPUTexture;     // R8 for pool detection
  temperature: GPUTexture;  // R16F for lava temperature
  sediment: GPUTexture;     // R16F for erosion sediment
  sedimentOut: GPUTexture;  // Ping-pong buffer for sediment
};

export function createFieldTex(device: GPUDevice, w: number, h: number, format: GPUTextureFormat = 'r32float'): GPUTexture {
  return device.createTexture({
    size: { width: w, height: h },
    format,
    usage: GPUTextureUsage.STORAGE_BINDING |
           GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_SRC |
           GPUTextureUsage.COPY_DST,
  });
}

// Helper for creating flow velocity textures (2-component)
export function createFlowTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return createFieldTex(device, w, h, 'rg32float'); // Use rg32float for storage binding compatibility
}

// Helper for creating flow velocity textures for sampling (not storage)
export function createFlowSampledTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return device.createTexture({
    size: { width: w, height: h },
    format: 'rg32float',
    usage: GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_SRC |
           GPUTextureUsage.COPY_DST,
  });
}

// Helper for creating mask textures (1-component, 8-bit)
export function createMaskTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return createFieldTex(device, w, h, 'r32float'); // Use r32float for storage binding compatibility
}

// Helper for creating depth/temperature textures (1-component, 16-bit float)
export function createDepthTex(device: GPUDevice, w: number, h: number): GPUTexture {
  return createFieldTex(device, w, h, 'r32float'); // Use r32float for storage binding compatibility
}

export function createFields(device: GPUDevice, w: number, h: number): Fields {
  return {
    // Material fields (r32float)
    soil: createFieldTex(device, w, h),
    rock: createFieldTex(device, w, h),
    lava: createFieldTex(device, w, h),
    deltaSoil: createFieldTex(device, w, h),
    deltaRock: createFieldTex(device, w, h),
    deltaLava: createFieldTex(device, w, h),
    soilOut: createFieldTex(device, w, h),

    // Canonical height texture
    height: createFieldTex(device, w, h),

    // Fluid simulation fields
    flow: createFlowTex(device, w, h),                    // RG32F for u,v (storage)
    flowOut: createFlowTex(device, w, h),                 // Ping-pong (storage)
    flowSampled: createFlowSampledTex(device, w, h),      // For sampling
    waterDepth: createDepthTex(device, w, h),             // R32F
    waterDepthOut: createDepthTex(device, w, h),          // Ping-pong
    waterDepthSampled: device.createTexture({
      size: { width: w, height: h },
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    }), // Water depth for sampling (r32float format)
    flowAccumulation: createFieldTex(device, w, h),       // R32F for precision
    poolMask: createMaskTex(device, w, h),                // R32F
    temperature: createDepthTex(device, w, h),            // R32F
    sediment: createDepthTex(device, w, h),               // R32F
    sedimentOut: createDepthTex(device, w, h),            // Ping-pong
  };
}

export const DENSITIES = {
  soil: 1600, // kg/m^3
  rock: 2600,
  lava: 2700,
} as const;