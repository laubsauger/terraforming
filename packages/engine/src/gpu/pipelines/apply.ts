// @ts-ignore - Vite handles .wgsl imports
import ApplyWGSL from '../shaders/ApplyDeltas.wgsl?raw';

export function createApplyPipeline(device: GPUDevice, layout: GPUBindGroupLayout): GPUComputePipeline {
  const module = device.createShaderModule({ code: ApplyWGSL });
  return device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'main' },
  });
}

export function createApplyBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // soil
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // rock
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // lava
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dSoil
      { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dRock
      { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: 'r32float' } }, // dLava
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
    ]
  });
}