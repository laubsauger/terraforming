import * as THREE from 'three/webgpu';
import { createTerrainMaterialTSL } from '../materials/TerrainMaterialTSL';
import { createWaterMaterialTSL } from '../materials/WaterMaterialTSL';
import { createDynamicWaterMaterialTSL } from '../materials/DynamicWaterMaterialTSL';
import { createDebugWaterMaterialTSL } from '../materials/DebugWaterMaterialTSL';
import { createCheckerDebugMaterialTSL } from '../materials/CheckerDebugMaterialTSL';
import { createLavaMaterialTSL } from '../materials/LavaMaterialTSL';
import type { TextureManager } from './TextureManager';

export interface MeshFactoryOptions {
  terrainSize: number;
  gridSize: number;
  heightScale: number;
  waterLevel: number;
  textureManager: TextureManager;
}

export class MeshFactory {
  private terrainSize: number;
  private gridSize: number;
  private heightScale: number;
  private waterLevel: number;
  private waterLevelNormalized: number;
  private textureManager: TextureManager;
  private currentShowContours: boolean = false; // Track current contour state

  // Meshes
  public terrainMesh?: THREE.Mesh;
  public waterMesh?: THREE.Mesh;
  public lavaMesh?: THREE.Mesh;
  public oceanMesh?: THREE.Mesh;

  // Cache for water material to avoid recreation
  private cachedWaterMaterial?: THREE.MeshPhysicalNodeMaterial;

  constructor(options: MeshFactoryOptions) {
    this.terrainSize = options.terrainSize;
    this.gridSize = options.gridSize;
    this.heightScale = options.heightScale;
    this.waterLevel = options.waterLevel;
    this.waterLevelNormalized = options.waterLevel / options.heightScale;
    this.textureManager = options.textureManager;
  }

  /**
   * Update terrain material with fluid simulation textures
   */
  public updateTerrainWithFluidTextures(waterDepthTexture: THREE.Texture): void {
    if (!this.terrainMesh) return;

    // Create new material with fluid textures
    const currentMaterial = this.terrainMesh.material as THREE.MeshStandardNodeMaterial;
    const newMaterial = createTerrainMaterialTSL({
      heightMap: this.textureManager.heightTexture,
      heightScale: this.heightScale,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      flowMap: this.textureManager.flowTexture,
      accumulationMap: this.textureManager.accumulationTexture,
      waterDepthMap: waterDepthTexture, // Add fluid water depth
      showContours: this.currentShowContours, // Preserve current contour state
      contourInterval: 0.05,
      waterLevel: this.waterLevelNormalized,
    });

    // Replace material
    this.terrainMesh.material = newMaterial;
    currentMaterial.dispose(); // Clean up old material
  }

  /**
   * Update water mesh with fluid depth texture - DEBUG VERSION
   */
  public updateWaterWithFluidTexture(waterDepthTexture: THREE.Texture): void {
    if (!this.waterMesh) {
      console.error('MeshFactory: No water mesh to update!');
      return;
    }

    console.log('MeshFactory: Updating water with fluid texture', {
      textureId: waterDepthTexture.id,
      textureUuid: waterDepthTexture.uuid,
      textureSource: waterDepthTexture.source?.data,
      hasSource: !!waterDepthTexture.source,
      waterMeshExists: !!this.waterMesh
    });

    // Always recreate with debug material for now
    const currentMaterial = this.waterMesh.material as THREE.Material;

    // Use CHECKER DEBUG material for maximum visibility
    const debugMaterial = createCheckerDebugMaterialTSL({
      waterDepthTexture: waterDepthTexture,
      heightTexture: this.textureManager.heightTexture,
      heightScale: this.heightScale
    });

    this.waterMesh.material = debugMaterial;
    if (currentMaterial && currentMaterial !== debugMaterial) {
      currentMaterial.dispose();
    }

    // Always make water visible
    this.waterMesh.visible = true;
    this.waterMesh.renderOrder = 100; // Render on top of everything

    // Compute bounding box for proper frustum culling
    this.waterMesh.geometry.computeBoundingBox();

    // Debug log mesh state
    const bounds = this.waterMesh.geometry.boundingBox;
    console.log('MeshFactory: Water mesh updated:', {
      visible: this.waterMesh.visible,
      renderOrder: this.waterMesh.renderOrder,
      position: this.waterMesh.position,
      bounds: bounds,
      hasDepthTexture: !!waterDepthTexture,
      materialType: debugMaterial.type,
      materialNeedsUpdate: debugMaterial.needsUpdate
    });
  }

  public createTerrain(scene: THREE.Scene, showContours: boolean = false): THREE.Mesh {
    this.currentShowContours = showContours; // Store initial state
    // Create terrain geometry - higher subdivision for better detail
    const subdivisions = 127; // 128x128 grid for detailed terrain
    const geometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      subdivisions,
      subdivisions
    );
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Create terrain material using TSL with GPU-based displacement
    const material = createTerrainMaterialTSL({
      heightMap: this.textureManager.heightTexture,
      heightScale: this.heightScale,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      flowMap: this.textureManager.flowTexture,
      accumulationMap: this.textureManager.accumulationTexture,
      showContours: showContours,
      contourInterval: 0.05,
      waterLevel: this.waterLevelNormalized,
    });

    // Create mesh - height displacement happens in vertex shader via TSL
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.matrixAutoUpdate = true;
    scene.add(this.terrainMesh);

    return this.terrainMesh;
  }

  public createOcean(scene: THREE.Scene): THREE.Mesh {
    // Create ocean water plane at sea level (always visible)
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      128, // Higher resolution for better shore blending
      128
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      opacity: 0.9,
      heightTexture: this.textureManager.heightTexture,
      waterLevel: this.waterLevelNormalized
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = this.waterLevel;
    this.oceanMesh.position.x = 0;
    this.oceanMesh.position.z = 0;
    this.oceanMesh.renderOrder = 1;
    scene.add(this.oceanMesh);

    return this.oceanMesh;
  }

  public createWater(scene: THREE.Scene): THREE.Mesh {
    // Create dynamic water surface - DEBUG VERSION
    // Use higher resolution for better water surface detail
    const waterGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      127, // Same subdivision as terrain for proper displacement
      127
    );
    waterGeometry.rotateX(-Math.PI / 2);

    // Use CHECKER DEBUG material for maximum visibility
    const waterMaterial = createCheckerDebugMaterialTSL({
      waterDepthTexture: this.textureManager.waterDepthTexture,
      heightTexture: this.textureManager.heightTexture,
      heightScale: this.heightScale
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0; // Base position, displacement handled by material
    this.waterMesh.visible = true; // START VISIBLE FOR DEBUG
    this.waterMesh.renderOrder = 100; // Render on top
    this.waterMesh.frustumCulled = false; // Always render
    scene.add(this.waterMesh);
    console.log('Created CHECKER DEBUG water mesh - should see pink/black checkerboard 10m above terrain!');

    return this.waterMesh;
  }

  public createLava(scene: THREE.Scene): THREE.Mesh {
    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for lava
      32
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterialTSL({
      lavaDepthMap: this.textureManager.lavaDepthTexture,
      temperatureMap: this.textureManager.temperatureTexture,
      flowMap: this.textureManager.flowTexture,
    });

    this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    this.lavaMesh.position.y = 0.02; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
    this.lavaMesh.castShadow = true;
    this.lavaMesh.receiveShadow = true;
    scene.add(this.lavaMesh);

    return this.lavaMesh;
  }

  public updateTerrainContours(showContours: boolean): void {
    if (!this.terrainMesh) return;
    this.currentShowContours = showContours; // Update stored state

    const oldMaterial = this.terrainMesh.material as THREE.Material;

    // Create new material with contour settings
    const newMaterial = createTerrainMaterialTSL({
      heightMap: this.textureManager.heightTexture,
      heightScale: this.heightScale,
      terrainSize: this.terrainSize,
      gridSize: this.gridSize,
      flowMap: this.textureManager.flowTexture,
      accumulationMap: this.textureManager.accumulationTexture,
      showContours: showContours,
      contourInterval: 0.05,
      waterLevel: this.waterLevelNormalized,
    });

    this.terrainMesh.material = newMaterial;
    oldMaterial.dispose();
  }

  public updateWaterVisibility(): void {
    if (this.waterMesh) {
      // Always visible for debug
      this.waterMesh.visible = true;
      console.log('Water mesh visibility: true (debug mode)');
    }
  }

  public updateLavaVisibility(): void {
    if (this.lavaMesh) {
      this.lavaMesh.visible = this.textureManager.hasLava();
    }
  }

  public dispose(): void {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }
    if (this.oceanMesh) {
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as THREE.Material).dispose();
    }
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }
    if (this.cachedWaterMaterial) {
      this.cachedWaterMaterial.dispose();
    }
  }
}