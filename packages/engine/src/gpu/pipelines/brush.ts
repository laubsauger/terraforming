// @ts-ignore - Vite handles .wgsl imports
import BrushWGSL from '../shaders/BrushPass_workgroup_quota.wgsl?raw';

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
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // soil
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // rock
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // lava
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δsoil
      { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δrock
      { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // Δlava
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
      { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // cellSize
      { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // densities
    ]
  });
}