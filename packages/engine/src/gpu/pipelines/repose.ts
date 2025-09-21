// @ts-ignore - Vite handles .wgsl imports
import ReposeWGSL from '../shaders/ThermalRepose_fixed.wgsl?raw';

export function createReposePipeline(device: GPUDevice, layout: GPUBindGroupLayout): GPUComputePipeline {
  const module = device.createShaderModule({ code: ReposeWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createReposeBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } },      // rock (read-only)
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'r32float' } }, // soil
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } }, // soilOut
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // cellSize
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // tanPhi
    ]
  });
}