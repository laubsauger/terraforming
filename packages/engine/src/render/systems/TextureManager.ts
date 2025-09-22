import * as THREE from 'three/webgpu';

export interface TextureManagerOptions {
  gridSize: number;
}

export class TextureManager {
  private gridSize: number;

  // Textures for simulation data
  public heightTexture: THREE.DataTexture;
  public flowTexture: THREE.DataTexture;
  public accumulationTexture: THREE.DataTexture;
  public waterDepthTexture: THREE.DataTexture;
  public lavaDepthTexture: THREE.DataTexture;
  public temperatureTexture: THREE.DataTexture;

  constructor(options: TextureManagerOptions) {
    this.gridSize = options.gridSize;

    // Initialize all textures
    this.heightTexture = this.createDataTexture();
    this.flowTexture = this.createDataTexture();
    this.accumulationTexture = this.createDataTexture();
    this.waterDepthTexture = this.createDataTexture();
    this.lavaDepthTexture = this.createDataTexture();
    this.temperatureTexture = this.createDataTexture();
  }

  private createDataTexture(): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4); // RGBA

    // Initialize with default values
    for (let i = 0; i < size * size * 4; i += 4) {
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 1; // A
    }

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;

    return texture;
  }

  public updateHeightmap(data: Float32Array): void {
    const size = this.gridSize;
    const textureData = this.heightTexture.image.data as Float32Array;

    // Clear existing data first to avoid artifacts
    textureData.fill(0);

    // Determine input data size
    const inputSize = Math.sqrt(data.length);

    if (inputSize !== size) {
      console.warn(`HeightMap size mismatch: input ${inputSize}x${inputSize}, expected ${size}x${size}. Resizing...`);

      // Resize the input data using bilinear interpolation
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const texIdx = (y * size + x) * 4; // RGBA format

          // Map to input coordinates
          const srcX = (x / (size - 1)) * (inputSize - 1);
          const srcY = (y / (size - 1)) * (inputSize - 1);

          // Bilinear interpolation
          const x0 = Math.floor(srcX);
          const x1 = Math.min(x0 + 1, inputSize - 1);
          const y0 = Math.floor(srcY);
          const y1 = Math.min(y0 + 1, inputSize - 1);

          const fx = srcX - x0;
          const fy = srcY - y0;

          const h00 = data[y0 * inputSize + x0] || 0;
          const h10 = data[y0 * inputSize + x1] || 0;
          const h01 = data[y1 * inputSize + x0] || 0;
          const h11 = data[y1 * inputSize + x1] || 0;

          const h0 = h00 * (1 - fx) + h10 * fx;
          const h1 = h01 * (1 - fx) + h11 * fx;
          const height = h0 * (1 - fy) + h1 * fy;

          // Set all channels to the same height value
          textureData[texIdx] = height;     // R
          textureData[texIdx + 1] = height; // G
          textureData[texIdx + 2] = height; // B
          textureData[texIdx + 3] = 1.0;    // A
        }
      }
    } else {
      // Direct copy when sizes match
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = y * size + x;
          const texIdx = idx * 4; // RGBA format
          const height = data[idx] || 0;

          // Set all channels to the same height value
          textureData[texIdx] = height;     // R
          textureData[texIdx + 1] = height; // G
          textureData[texIdx + 2] = height; // B
          textureData[texIdx + 3] = 1.0;    // A
        }
      }
    }

    this.heightTexture.needsUpdate = true;
  }

  public getCurrentHeightmap(): Float32Array | null {
    if (!this.heightTexture || !this.heightTexture.image) return null;

    const size = this.gridSize;
    const textureData = this.heightTexture.image.data as Float32Array;
    const heightData = new Float32Array(size * size);

    // Extract height values from RGBA texture (use R channel)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const texIdx = idx * 4; // RGBA format
        heightData[idx] = textureData[texIdx]; // R channel contains height
      }
    }

    return heightData;
  }

  public updateFlowmap(data: Float32Array): void {
    const textureData = this.flowTexture.image.data as Float32Array;
    textureData.set(data);
    this.flowTexture.needsUpdate = true;
  }

  public updateAccumulationMap(data: Float32Array): void {
    const textureData = this.accumulationTexture.image.data as Float32Array;
    textureData.set(data);
    this.accumulationTexture.needsUpdate = true;
  }

  public updateWaterDepth(data: Float32Array): void {
    const textureData = this.waterDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.waterDepthTexture.needsUpdate = true;
  }

  public updateLavaDepth(data: Float32Array): void {
    const textureData = this.lavaDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.lavaDepthTexture.needsUpdate = true;
  }

  public updateTemperature(data: Float32Array): void {
    const textureData = this.temperatureTexture.image.data as Float32Array;
    textureData.set(data);
    this.temperatureTexture.needsUpdate = true;
  }

  public hasWater(): boolean {
    const data = this.waterDepthTexture.image.data as Float32Array;
    return data.some((v) => v > 0.01);
  }

  public hasLava(): boolean {
    const data = this.lavaDepthTexture.image.data as Float32Array;
    return data.some((v) => v > 0.01);
  }

  public dispose(): void {
    this.heightTexture.dispose();
    this.flowTexture.dispose();
    this.accumulationTexture.dispose();
    this.waterDepthTexture.dispose();
    this.lavaDepthTexture.dispose();
    this.temperatureTexture.dispose();
  }
}