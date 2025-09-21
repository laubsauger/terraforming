import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BaseRenderer } from './BaseRenderer';
import { createTerrainMaterialTSL } from './materials/TerrainMaterialTSL';
import { createWaterMaterialTSL } from './materials/WaterMaterialTSL';
import { createLavaMaterialTSL } from './materials/LavaMaterialTSL';

export interface TerrainRendererOptions {
  canvas: HTMLCanvasElement;
  gridSize?: number;
  terrainSize?: number;
}

export class TerrainRenderer extends BaseRenderer {
  private controls: OrbitControls;

  private terrainMesh?: THREE.Mesh;
  private waterMesh?: THREE.Mesh;
  private lavaMesh?: THREE.Mesh;
  private oceanMesh?: THREE.Mesh;

  // Debug settings
  private showContours = true; // Enable by default

  private gridSize: number;
  private terrainSize: number;

  // Day/night cycle
  private sunLight!: THREE.DirectionalLight;
  private moonLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private timeOfDay = 0.15625; // 0-1, where 0.25 = noon, 0.75 = midnight, 0.15625 = 3:45 AM
  private dayNightCycleActive = false;
  private cycleSpeed = 0.0001; // Speed of day/night cycle

  // Textures for simulation data
  private heightTexture: THREE.DataTexture;
  private flowTexture: THREE.DataTexture;
  private accumulationTexture: THREE.DataTexture;
  private waterDepthTexture: THREE.DataTexture;
  private lavaDepthTexture: THREE.DataTexture;
  private temperatureTexture: THREE.DataTexture;

  constructor(options: TerrainRendererOptions) {
    const { canvas, gridSize = 256, terrainSize = 100 } = options;

    // Initialize base renderer
    super({ canvas, antialias: true, alpha: false });

    this.gridSize = gridSize;
    this.terrainSize = terrainSize;

    // Setup scene
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue
    this.scene.fog = new THREE.Fog(0x87CEEB, 100, 500);

    // Setup camera - position opposite to main light for better illumination
    this.camera.position.set(-45, 35, -45);
    this.camera.lookAt(0, 0, 0);

    // Setup orbit controls
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go below ground

    // Setup shift key handling to disable camera controls during brush adjustment
    this.setupShiftKeyHandling();

    // Setup lighting
    this.setupLighting();

    // Initialize textures
    this.heightTexture = this.createDataTexture();
    this.flowTexture = this.createDataTexture();
    this.accumulationTexture = this.createDataTexture();
    this.waterDepthTexture = this.createDataTexture();
    this.lavaDepthTexture = this.createDataTexture();
    this.temperatureTexture = this.createDataTexture();

    // Terrain will be created after renderer is ready
  }

  protected override onRendererReady(): void {
    console.log('TerrainRenderer: WebGPU renderer ready');

    // Create terrain after renderer is ready
    this.createTerrain();

    // Generate default island terrain
    this.generateTestTerrain();

    // Debug logging
    console.log('TerrainRenderer: Scene children count:', this.scene.children.length);
    console.log('TerrainRenderer: Terrain mesh added:', !!this.terrainMesh);
    console.log('TerrainRenderer: Ocean mesh added:', !!this.oceanMesh);
  }

  /**
   * Get the terrain mesh for raycasting
   */
  public getTerrainMesh(): THREE.Mesh | undefined {
    return this.terrainMesh;
  }

  /**
   * Get the height texture for terrain-following cursor
   */
  public getHeightTexture(): THREE.DataTexture {
    return this.heightTexture;
  }

  /**
   * Setup shift key handling to disable camera controls during brush adjustment
   */
  private setupShiftKeyHandling(): void {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = false;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.controls.enabled = true;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Store references for cleanup
    (this as any)._keyHandlers = { handleKeyDown, handleKeyUp };
  }

  /**
   * Get height at world coordinates by sampling height texture
   */
  public getHeightAtWorldPos(worldX: number, worldZ: number): number {
    // Convert world coordinates to texture coordinates
    const halfSize = this.terrainSize / 2;
    const u = (worldX + halfSize) / this.terrainSize;
    const v = (worldZ + halfSize) / this.terrainSize;

    // Clamp to texture bounds
    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));

    // Sample from height texture
    const textureSize = this.gridSize;
    const x = Math.floor(clampedU * (textureSize - 1));
    const y = Math.floor(clampedV * (textureSize - 1));

    const data = this.heightTexture.image.data as Float32Array;
    const index = (y * textureSize + x) * 4; // RGBA format
    const heightValue = data[index]; // Height is stored in R channel

    // Apply height scale (matching the material)
    return heightValue * 15; // Same scale as material
  }

  private setupLighting(): void {
    // Enable shadow mapping on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Better quality soft shadows

    // Ambient light - will be adjusted based on time of day
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.3);
    this.scene.add(this.ambientLight);

    // Sun light - warm yellow/white
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.5);
    this.sunLight.castShadow = true;

    // Configure sun shadow camera for better quality
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -60;
    this.sunLight.shadow.camera.right = 60;
    this.sunLight.shadow.camera.top = 60;
    this.sunLight.shadow.camera.bottom = -60;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Moon light - cool blue/white
    this.moonLight = new THREE.DirectionalLight(0xb0c4ff, 0.4);
    this.moonLight.castShadow = true;

    // Configure moon shadow camera (softer shadows)
    this.moonLight.shadow.mapSize.width = 1024;
    this.moonLight.shadow.mapSize.height = 1024;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 200;
    this.moonLight.shadow.camera.left = -60;
    this.moonLight.shadow.camera.right = 60;
    this.moonLight.shadow.camera.top = 60;
    this.moonLight.shadow.camera.bottom = -60;
    this.moonLight.shadow.bias = -0.001;
    this.scene.add(this.moonLight);

    // Initialize lighting positions
    this.updateDayNightCycle();
  }

  /**
   * Update the day/night cycle
   */
  private updateDayNightCycle(): void {
    // Convert time to radians for circular motion
    const angle = this.timeOfDay * Math.PI * 2;

    // Early autumn sun arc - tilted 30 degrees from vertical
    const sunTilt = Math.PI / 6; // 30 degrees tilt
    // Maximum elevation is 60 degrees (not 90)

    // Calculate sun position on tilted arc
    const sunX = Math.sin(angle) * 50;
    const sunY = Math.cos(angle) * Math.cos(sunTilt) * 50; // Height affected by tilt
    const sunZ = Math.cos(angle) * Math.sin(sunTilt) * 50; // Depth affected by tilt

    // Set sun position (only above horizon during day)
    this.sunLight.position.set(sunX, Math.max(0, sunY), sunZ);
    this.sunLight.visible = sunY > -5; // Visible slightly below horizon for sunset

    // Moon is opposite to sun
    const moonX = -sunX;
    const moonY = -sunY;
    const moonZ = -sunZ;

    // Set moon position (only above horizon during night)
    this.moonLight.position.set(moonX, Math.max(0, moonY), moonZ);
    this.moonLight.visible = moonY > -5; // Visible slightly below horizon

    // Adjust light intensities based on sun elevation
    const sunElevation = Math.max(0, sunY / 50); // 0 to 1
    const moonElevation = Math.max(0, moonY / 50); // 0 to 1

    // Sun intensity varies with elevation
    this.sunLight.intensity = sunElevation * 1.5;

    // Moon intensity varies with elevation
    this.moonLight.intensity = moonElevation * 0.4;

    // Ambient light varies throughout the day
    // Brighter during day, darker at night
    const dayFactor = Math.max(0, Math.cos(angle)); // 1 at noon, -1 at midnight
    const ambientIntensity = 0.2 + dayFactor * 0.3; // 0.2 to 0.5
    this.ambientLight.intensity = ambientIntensity;

    // Adjust ambient color - warmer during sunrise/sunset
    const twilightFactor = Math.abs(Math.sin(angle * 2)) * (1 - Math.abs(dayFactor));
    const ambientR = 1.0;
    const ambientG = 1.0 - twilightFactor * 0.2; // Slightly less green during twilight
    const ambientB = 1.0 - twilightFactor * 0.4; // Much less blue during twilight
    this.ambientLight.color.setRGB(ambientR, ambientG, ambientB);

    // Adjust sun color during sunrise/sunset
    if (sunElevation < 0.3 && sunElevation > 0) {
      const sunsetFactor = 1 - (sunElevation / 0.3);
      this.sunLight.color.setRGB(
        1.0,
        1.0 - sunsetFactor * 0.2,
        0.9 - sunsetFactor * 0.3
      );
    } else {
      this.sunLight.color.setHex(0xfffaed); // Normal sun color
    }
  }

  /**
   * Set the time of day (0-1)
   */
  public setTimeOfDay(time: number): void {
    this.timeOfDay = time % 1; // Ensure it wraps around
    this.updateDayNightCycle();
  }

  /**
   * Start or stop the day/night cycle animation
   */
  public setDayNightCycleActive(active: boolean): void {
    this.dayNightCycleActive = active;
  }

  /**
   * Set the speed of the day/night cycle
   */
  public setCycleSpeed(speed: number): void {
    this.cycleSpeed = speed;
  }

  private createDataTexture(): THREE.DataTexture {
    const size = this.gridSize;
    const data = new Float32Array(size * size * 4);

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat, // Always use RGBA for consistency
      THREE.FloatType
    );
    texture.needsUpdate = true;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter; // No mipmaps for data textures
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; // Disable mipmaps for data textures

    return texture;
  }

  private createTerrain(): void {
    // Create terrain geometry - use lower subdivision for smoother terrain
    const subdivisions = 63; // 64x64 grid for smooth terrain
    const geometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      subdivisions,
      subdivisions
    );
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Create terrain material using TSL with GPU-based displacement
    const material = createTerrainMaterialTSL({
      heightMap: this.heightTexture,
      heightScale: 15,
      terrainSize: this.terrainSize,
      flowMap: this.flowTexture,
      accumulationMap: this.accumulationTexture,
      showContours: this.showContours, // Enable contours by default
      contourInterval: 0.05,
    });

    // Create mesh - height displacement happens in vertex shader via TSL
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.castShadow = true;
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);

    // No need to update vertices - GPU handles displacement via heightTexture

    // Create ocean water plane at sea level (always visible)
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize * 1.1, // Slightly larger than terrain for clean edges
      this.terrainSize * 1.1,
      1, // Simple plane for ocean
      1
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      color: new THREE.Color(0x006994),
      opacity: 0.85,
      heightTexture: this.heightTexture, // Pass height texture for depth calculation
      waterLevel: 2.1 / 15 // Normalized water level (2.1 units / 15 height scale)
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = 2.1; // Water level for visible ocean (0.14 normalized, clearly below beach at 0.15)
    this.scene.add(this.oceanMesh);

    // Create dynamic water surface (initially invisible) - for rivers/lakes
    const waterGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for water
      32
    );
    waterGeometry.rotateX(-Math.PI / 2);

    const waterMaterial = createWaterMaterialTSL({
      color: new THREE.Color(0x0099cc),
      opacity: 0.4,
      depthTexture: this.waterDepthTexture
    });

    this.waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    this.waterMesh.position.y = 0.3; // Lower water level to show shallow areas
    this.waterMesh.visible = false; // Start hidden until we have water depth data
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);

    // Create lava surface (initially invisible)
    const lavaGeometry = new THREE.PlaneGeometry(
      this.terrainSize,
      this.terrainSize,
      32, // Fixed low resolution for lava
      32
    );
    lavaGeometry.rotateX(-Math.PI / 2);

    const lavaMaterial = createLavaMaterialTSL({
      lavaDepthMap: this.lavaDepthTexture,
      temperatureMap: this.temperatureTexture,
      flowMap: this.flowTexture,
    });

    this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
    this.lavaMesh.position.y = 0.02; // Slightly above terrain, below water
    this.lavaMesh.visible = false; // Start hidden
    this.lavaMesh.castShadow = true;
    this.lavaMesh.receiveShadow = true;
    this.scene.add(this.lavaMesh);
  }

private generateTestTerrain(): void {
    // Generate an island terrain with beaches, mountains, and water
    const size = this.gridSize;
    const data = this.heightTexture.image.data as Float32Array;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Normalized coordinates (-0.5 to 0.5)
        const nx = x / size - 0.5;
        const ny = y / size - 0.5;

        // Distance from center
        const dist = Math.sqrt(nx * nx + ny * ny);

        // Start with base island shape - smaller main island
        let height = Math.max(0, 1 - dist * 3.5) * 0.28; // Smaller, more compact base island

        // Add smooth mountain features to main island
        if (height > 0.02) {
          // Multiple mountain peaks for variety (reduced to prevent plateau)
          const ridge1 = Math.exp(-Math.pow(nx - ny, 2) * 10) * 0.15;
          const ridge2 = Math.exp(-Math.pow(nx + ny * 0.8, 2) * 12) * 0.12;

          // Off-center tall peak (reduced height)
          const peakDist = Math.sqrt((nx - 0.1) * (nx - 0.1) + (ny + 0.1) * (ny + 0.1));
          const mainPeak = Math.exp(-peakDist * peakDist * 15) * 0.25;

          height += ridge1 + ridge2 + mainPeak;

          // Add gentle rolling hills
          height += Math.sin(nx * Math.PI * 3) * Math.cos(ny * Math.PI * 3) * 0.02;

          // Create a more organic lagoon - use noise-like pattern
          const lagoonX = -0.12;
          const lagoonY = 0.08;
          const lagoonDist = Math.sqrt((nx - lagoonX) * (nx - lagoonX) + (ny - lagoonY) * (ny - lagoonY));
          const lagoonAngle = Math.atan2(ny - lagoonY, nx - lagoonX);
          const lagoonRadius = 0.1 + Math.sin(lagoonAngle * 3) * 0.02 + Math.cos(lagoonAngle * 5) * 0.015;

          if (lagoonDist < lagoonRadius) {
            // Create organic shaped depression
            const depthFactor = 1 - (lagoonDist / lagoonRadius);
            const lagoonDepression = depthFactor * depthFactor * 0.08;
            height -= lagoonDepression;

            // Keep irregular rim just above water (water at 0.14)
            if (lagoonDist > lagoonRadius * 0.7) {
              const rimNoise = Math.sin(lagoonAngle * 7) * 0.01;
              height = Math.max(height, 0.145 + rimNoise); // Variable rim height
            }
          }
        }

        // Add smaller islands and sandbanks
        // Rocky outcrop to the northeast - more prominent
        const island1X = 0.28;
        const island1Y = 0.22;
        const island1Dist = Math.sqrt((nx - island1X) * (nx - island1X) + (ny - island1Y) * (ny - island1Y));
        if (island1Dist < 0.15) {
          const island1Height = Math.max(0, 1 - island1Dist * 8) * 0.25;
          // Add some rocky texture
          const rockNoise = Math.sin(nx * 20) * Math.cos(ny * 20) * 0.01;
          height = Math.max(height, island1Height + rockNoise);
        }

        // Small crescent atoll to the southwest
        const island2X = -0.32;
        const island2Y = -0.18;
        const island2Dist = Math.sqrt((nx - island2X) * (nx - island2X) + (ny - island2Y) * (ny - island2Y));
        const island2Angle = Math.atan2(ny - island2Y, nx - island2X);
        // Create crescent shape
        const crescentFactor = 1 + Math.cos(island2Angle) * 0.3;
        if (island2Dist < 0.08 * crescentFactor) {
          const island2Height = Math.max(0, 1 - island2Dist * 15) * 0.17;
          height = Math.max(height, island2Height);
        }

        // Sandbank to the east
        const sandbank1Dist = Math.sqrt((nx - 0.35) * (nx - 0.35) + (ny - 0.05) * (ny - 0.05));
        const sandbank1Height = Math.max(0, 1 - sandbank1Dist * 6) * 0.04;
        height = Math.max(height, sandbank1Height);

        // Sandbank to the west (elongated)
        const sandbank2DistX = Math.abs(nx + 0.28) * 3;
        const sandbank2DistY = Math.abs(ny + 0.08) * 8;
        const sandbank2Dist = Math.sqrt(sandbank2DistX * sandbank2DistX + sandbank2DistY * sandbank2DistY);
        const sandbank2Height = Math.max(0, 1 - sandbank2Dist * 1.5) * 0.035;
        height = Math.max(height, sandbank2Height);

        // Create ultra-shallow beach slopes in the narrow beach zone
        // Water is at 0.14 (2.1/15), beach zone is 0.135-0.145 (very narrow)
        const waterLevel = 0.14;
        if (height > 0.15 && height < 0.25) {
          // Force ultra-shallow slope near water line
          const distFromWater = Math.abs(height - waterLevel);
          if (distFromWater < 0.03) {
            // Very gentle cubic easing for beach slope
            const beachT = distFromWater / 0.03;
            height = waterLevel + (height > waterLevel ? 1 : -1) * 0.03 * Math.pow(beachT, 3);
          }

          // Smooth transition to higher terrain
          if (height > 0.18 && height < 0.22) {
            const t = (height - 0.18) / 0.04;
            const smoothT = t * t * (3 - 2 * t);
            height = 0.18 + smoothT * 0.04;
          }
        }

        // Ocean floor with some variation
        if (dist > 0.5) {
          // Varying ocean floor depth
          const oceanDepth = 0.005 + Math.sin(nx * 8) * Math.cos(ny * 6) * 0.002;
          height = Math.max(height, oceanDepth);
        }

        // Clamp to valid range
        height = Math.max(0, Math.min(1, height));

        data[idx] = height;
        data[idx + 1] = height;
        data[idx + 2] = height;
        data[idx + 3] = 1;
      }
    }

    this.heightTexture.needsUpdate = true;
    // GPU will automatically use updated texture for displacement
  }

  public updateHeightmap(data: Float32Array): void {
    const textureData = this.heightTexture.image.data as Float32Array;
    textureData.set(data);
    this.heightTexture.needsUpdate = true;
    // GPU will automatically use updated texture for displacement
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

  /**
   * Toggle topographic contour lines
   */
  public setShowContours(show: boolean): void {
    if (this.showContours === show) return;
    this.showContours = show;

    // Recreate terrain material with contour settings
    if (this.terrainMesh) {
      const oldMaterial = this.terrainMesh.material as THREE.Material;

      // Create new material with contour settings
      const newMaterial = createTerrainMaterialTSL({
        heightMap: this.heightTexture,
        heightScale: 15,
        terrainSize: this.terrainSize,
        flowMap: this.flowTexture,
        accumulationMap: this.accumulationTexture,
        showContours: show,
        contourInterval: 0.05, // Every 5% height = 0.75m with scale 15
      });

      this.terrainMesh.material = newMaterial;
      oldMaterial.dispose();
    }
  }

  public override render(): void {
    this.controls.update();

    // Update day/night cycle if active
    if (this.dayNightCycleActive) {
      this.timeOfDay += this.cycleSpeed;
      if (this.timeOfDay > 1) {
        this.timeOfDay -= 1;
      }
      this.updateDayNightCycle();
    }

    super.render();
  }

  public override dispose(): void {
    this.controls.dispose();

    // Clean up shift key handlers
    const keyHandlers = (this as any)._keyHandlers;
    if (keyHandlers) {
      window.removeEventListener('keydown', keyHandlers.handleKeyDown);
      window.removeEventListener('keyup', keyHandlers.handleKeyUp);
    }

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
    if (this.oceanMesh) {
      this.oceanMesh.geometry.dispose();
      (this.oceanMesh.material as THREE.Material).dispose();
    }
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}