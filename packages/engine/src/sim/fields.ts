export type Fields = {
  soil: GPUTexture;
  rock: GPUTexture;
  lava: GPUTexture;
  deltaSoil: GPUTexture;
  deltaRock: GPUTexture;
  deltaLava: GPUTexture;
  // Additional texture for thermal repose ping-pong
  soilOut: GPUTexture;
};

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
  return {
    soil: createFieldTex(device, w, h),
    rock: createFieldTex(device, w, h),
    lava: createFieldTex(device, w, h),
    deltaSoil: createFieldTex(device, w, h),
    deltaRock: createFieldTex(device, w, h),
    deltaLava: createFieldTex(device, w, h),
    soilOut: createFieldTex(device, w, h),
  };
}

export const DENSITIES = {
  soil: 1600, // kg/m^3
  rock: 2600,
  lava: 2700,
} as const;