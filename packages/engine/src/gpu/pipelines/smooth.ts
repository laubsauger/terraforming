// @ts-ignore - Vite handles .wgsl imports
import SmoothWGSL from '../shaders/SmoothPass.wgsl?raw';

export function createSmoothBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    label: 'Smooth Bind Group Layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' }, // smooth ops
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'read-only',
          format: 'rgba32float',
          viewDimension: '2d',
        }, // fieldsIn
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: 'rgba32float',
          viewDimension: '2d',
        }, // fieldsOut
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }, // gridSize
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }, // cellSize
      },
    ],
  });
}

export function createSmoothPipeline(
  device: GPUDevice,
  bindGroupLayout: GPUBindGroupLayout
): GPUComputePipeline {
  const pipelineLayout = device.createPipelineLayout({
    label: 'Smooth Pipeline Layout',
    bindGroupLayouts: [bindGroupLayout],
  });

  return device.createComputePipeline({
    label: 'Smooth Pipeline',
    layout: pipelineLayout,
    compute: {
      module: device.createShaderModule({
        label: 'Smooth Shader Module',
        code: SmoothWGSL,
      }),
      entryPoint: 'main',
    },
  });
}