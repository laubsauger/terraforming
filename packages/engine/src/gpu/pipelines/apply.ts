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
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'rgba32float' } }, // fields input (RGBA)
      { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba32float' } }, // fields output (RGBA)
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-only', format: 'rgba32float' } }, // deltas (RGBA)
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, // gridSize
    ]
  });
}