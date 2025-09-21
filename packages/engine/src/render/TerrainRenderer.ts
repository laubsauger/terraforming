import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createTerrainMaterial } from './materials/TerrainMaterial';
import { createWaterMaterial } from './materials/WaterMaterial';
import { createLavaMaterial } from './materials/LavaMaterial';

export interface TerrainRendererOptions {
  canvas: HTMLCanvasElement;
  gridSize?: number;
  terrainSize?: number;
}

export class TerrainRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private terrainMesh?: THREE.Mesh;
  private waterMesh?: THREE.Mesh;
  private lavaMesh?: THREE.Mesh;

  private gridSize: number;
  private terrainSize: number;

  // Textures for simulation data
  private heightTexture: THREE.DataTexture;
  private flowTexture: THREE.DataTexture;
  private accumulationTexture: THREE.DataTexture;
  private waterDepthTexture: THREE.DataTexture;
  private lavaDepthTexture: THREE.DataTexture;
  private temperatureTexture: THREE.DataTexture;

  constructor(options: TerrainRendererOptions) {
    const { canvas, gridSize = 256, terrainSize = 100 } = options;

    this.gridSize = gridSize;
    this.terrainSize = terrainSize;

    // Initialize WebGL renderer (WebGPU support will be added later)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.width, canvas.height);

    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 100, 500);

    // Setup camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.width / canvas.height,
      0.1,
      1000
    );
    this.camera.position.set(50, 30, 50);
    this.camera.lookAt(0, 0, 0);

    // Setup orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground

    // Setup lighting
    this.setupLighting();

    // Initialize textures
    this.heightTexture = this.createDataTexture();
    this.flowTexture = this.createDataTexture(2);
    this.accumulationTexture = this.createDataTexture();
    this.waterDepthTexture = this.createDataTexture();
    this.lavaDepthTexture = this.createDataTexture();
    this.temperatureTexture = this.createDataTexture();

    // Create initial terrain
    this.createTerrain();

    // Generate test height data
    this.generateTestTerrain();
  }

  private setupLighting(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);

    // Helper to visualize light
    // const helper = new THREE.DirectionalLightHelper(directionalLight, 5);
    // this.scene.add(helper);
  }

  private createDataTexture(components: number = 1): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4);

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      components === 1 ? THREE.RedFormat : THREE.RGFormat,
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    return texture;
  }

  private createTerrain(): void {
    // Create terrain geometry - a subdivided plane
    const geometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      this.gridSize - 1,
      this.gridSize - 1
    );
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Create terrain material using TSL
    const material = createTerrainMaterial({
      heightMap: this.heightTexture,
      flowMap: this.flowTexture,
      accumulationMap: this.accumulationTexture,
    });

    // Create mesh
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.scene.add(this.terrainMesh);

    // Create water surface (initially invisible)
    const waterGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      this.gridSize / 4 - 1,
      this.gridSize / 4 - 1
    );
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = createWaterMaterial({
      waterDepthMap: this.waterDepthTexture,
      flowMap: this.flowTexture,
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.1; // Slightly above terrain
    this.waterMesh.visible = false; // Start hidden
    this.scene.add(this.waterMesh);

    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      this.gridSize / 4 - 1,
      this.gridSize / 4 - 1
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterial({
      lavaDepthMap: this.lavaDepthTexture,
      temperatureMap: this.temperatureTexture,
      flowMap: this.flowTexture,
    });

    this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    this.lavaMesh.position.y = 0.05; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
    this.scene.add(this.lavaMesh);
  }

  private generateTestTerrain(): void {
    // Generate some test height data with hills and valleys
    const size = this.gridSize;
    const data = this.heightTexture.image.data as Float32Array;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Create some hills using sine waves
        const nx = x / size - 0.5;
        const ny = y / size - 0.5;

        let height = 0;

        // Large hills
        height += Math.sin(nx * Math.PI * 2) * Math.cos(ny * Math.PI * 2) * 0.3;

        // Medium features
        height += Math.sin(nx * Math.PI * 4) * Math.cos(ny * Math.PI * 4) * 0.15;

        // Small noise
        height += (Math.random() - 0.5) * 0.05;

        // Valley in the center
        const dist = Math.sqrt(nx * nx + ny * ny);
        height -= Math.exp(-dist * dist * 10) * 0.5;

        // Normalize to 0-1 range
        height = (height + 1) * 0.5;

        data[idx] = height;
        data[idx + 1] = height;
        data[idx + 2] = height;
        data[idx + 3] = 1;
      }
    }

    this.heightTexture.needsUpdate = true;
  }

  public updateHeightmap(data: Float32Array): void {
    const textureData = this.heightTexture.image.data as Float32Array;
    textureData.set(data);
    this.heightTexture.needsUpdate = true;
  }

  public updateFlowmap(data: Float32Array): void {
    const textureData = this.flowTexture.image.data as Float32Array;
    textureData.set(data);
    this.flowTexture.needsUpdate = true;
  }

  public updateWaterDepth(data: Float32Array): void {
    const textureData = this.waterDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.waterDepthTexture.needsUpdate = true;

    // Show/hide water mesh based on presence of water
    const hasWater = data.some(v => v > 0.01);
    if (this.waterMesh) {
      this.waterMesh.visible = hasWater;
    }
  }

  public updateLavaDepth(data: Float32Array): void {
    const textureData = this.lavaDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.lavaDepthTexture.needsUpdate = true;

    // Show/hide lava mesh based on presence of lava
    const hasLava = data.some(v => v > 0.01);
    if (this.lavaMesh) {
      this.lavaMesh.visible = hasLava;
    }
  }

  public updateTemperature(data: Float32Array): void {
    const textureData = this.temperatureTexture.image.data as Float32Array;
    textureData.set(data);
    this.temperatureTexture.needsUpdate = true;
  }

  public setDebugMode(mode: number): void {
    // Update debug mode on materials
    if (this.terrainMesh) {
      const material = this.terrainMesh.material as any;
      if (material.uniforms?.debugMode) {
        material.uniforms.debugMode.value = mode;
      }
    }
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();

    // Dispose textures
    this.heightTexture.dispose();
    this.flowTexture.dispose();
    this.accumulationTexture.dispose();
    this.waterDepthTexture.dispose();
    this.lavaDepthTexture.dispose();
    this.temperatureTexture.dispose();

    // Dispose geometries and materials
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }
  }
}