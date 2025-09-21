// @ts-ignore - Vite handles .wgsl imports
import BrushWGSL from '../shaders/BrushPass_optimized.wgsl?raw';

export function createBrushPipeline(device: GPUDevice, layout: GPUBindGroupLayout): GPUComputePipeline {
  const module = device.createShaderModule({ code: BrushWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createBrushBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // ops
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },          // hand
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'rgba32float' } }, // fields (RGBA: soil, rock, lava, unused)
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } }, // deltas (RGBA: Δsoil, Δrock, Δlava, unused) - write-only
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // cellSize
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // densities
    ]
  });
}