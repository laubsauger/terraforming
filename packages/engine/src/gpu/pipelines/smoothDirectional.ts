import smoothDirectionalShader from '../shaders/SmoothDirectionalPass.wgsl?raw';

export interface SmoothDirectionalOp {
  center: [number, number]; // world coordinates
  radius: number;
  strength: number;
  mode: number; // -1 = lower only, 0 = both, 1 = raise only
  dt: number;
}

export interface SmoothDirectionalPipeline {
  pipeline: GPUComputePipeline;
  bindGroupLayout: GPUBindGroupLayout;
}

export function createSmoothDirectionalPipeline(device: GPUDevice): SmoothDirectionalPipeline {
  const shaderModule = device.createShaderModule({
    label: 'Smooth Directional Shader',
    code: smoothDirectionalShader,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    label: 'Smooth Directional Bind Group Layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'read-only',
          format: 'rgba32float',
          viewDimension: '2d',
        },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: 'rgba32float',
          viewDimension: '2d',
        },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
      {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });

  const pipeline = device.createComputePipeline({
    label: 'Smooth Directional Pipeline',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    compute: {
      module: shaderModule,
      entryPoint: 'main',
    },
  });

  return { pipeline, bindGroupLayout };
}

export function executeSmoothDirectionalPass(
  device: GPUDevice,
  pipeline: SmoothDirectionalPipeline,
  commandEncoder: GPUCommandEncoder,
  fieldsIn: GPUTexture,
  fieldsOut: GPUTexture,
  ops: SmoothDirectionalOp[],
  gridSize: [number, number],
  cellSize: number
): void {
  if (ops.length === 0) return;

  // Create operations buffer
  const opsData = new Float32Array(ops.length * 6);
  ops.forEach((op, i) => {
    opsData[i * 6 + 0] = op.center[0];
    opsData[i * 6 + 1] = op.center[1];
    opsData[i * 6 + 2] = op.radius;
    opsData[i * 6 + 3] = op.strength;
    opsData[i * 6 + 4] = op.mode;
    opsData[i * 6 + 5] = op.dt;
  });

  const opsBuffer = device.createBuffer({
    label: 'Smooth Directional Ops Buffer',
    size: opsData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(opsBuffer, 0, opsData);

  // Create uniform buffers
  const gridSizeBuffer = device.createBuffer({
    label: 'Grid Size Buffer',
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(gridSizeBuffer, 0, new Uint32Array(gridSize));

  const cellSizeBuffer = device.createBuffer({
    label: 'Cell Size Buffer',
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(cellSizeBuffer, 0, new Float32Array([cellSize]));

  // Create bind group
  const bindGroup = device.createBindGroup({
    label: 'Smooth Directional Bind Group',
    layout: pipeline.bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: opsBuffer } },
      { binding: 1, resource: fieldsIn.createView() },
      { binding: 2, resource: fieldsOut.createView() },
      { binding: 3, resource: { buffer: gridSizeBuffer } },
      { binding: 4, resource: { buffer: cellSizeBuffer } },
    ],
  });

  // Execute compute pass
  const computePass = commandEncoder.beginComputePass({
    label: 'Smooth Directional Compute Pass',
  });

  computePass.setPipeline(pipeline.pipeline);
  computePass.setBindGroup(0, bindGroup);

  const workgroupsX = Math.ceil(gridSize[0] / 8);
  const workgroupsY = Math.ceil(gridSize[1] / 8);
  computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

  computePass.end();

  // Cleanup
  opsBuffer.destroy();
  gridSizeBuffer.destroy();
  cellSizeBuffer.destroy();
}