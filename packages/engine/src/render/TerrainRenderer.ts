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
  private sunSphere!: THREE.Mesh;
  private moonSphere!: THREE.Mesh;
  private timeOfDay = 0.85; // 0-1, where 0 = midnight, 0.25 = 6am, 0.5 = noon, 0.75 = 6pm, 0.85 = ~8pm
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

    // Setup scene with better fog for distance falloff
    const fogColor = 0xa0c8e0; // Slightly muted sky blue for better blending
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.Fog(fogColor, 50, 180); // Closer fog for smoother falloff

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

    // Generate improved test terrain
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

    // Ambient light - will be adjusted based on time of day (reduced for less overexposure)
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.2);
    this.scene.add(this.ambientLight);

    // Sun light - warm yellow/white (reduced intensity to prevent overexposure)
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.0);
    this.sunLight.castShadow = true;

    // Configure sun shadow camera for better quality
    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 200;
    this.sunLight.shadow.camera.left = -60;
    this.sunLight.shadow.camera.right = 60;
    this.sunLight.shadow.camera.top = 60;
    this.sunLight.shadow.camera.bottom = -60;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.needsUpdate = true;
    this.sunLight.shadow.autoUpdate = false; // Manual control for consistency
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target); // Add target to scene for proper world-space lighting

    // Moon light - deeper blue tint, dimmer
    this.moonLight = new THREE.DirectionalLight(0x6080ff, 0.25);
    this.moonLight.castShadow = true;

    // Configure moon shadow camera (softer shadows)
    this.moonLight.shadow.mapSize.width = 2048;
    this.moonLight.shadow.mapSize.height = 2048;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 200;
    this.moonLight.shadow.camera.left = -60;
    this.moonLight.shadow.camera.right = 60;
    this.moonLight.shadow.camera.top = 60;
    this.moonLight.shadow.camera.bottom = -60;
    this.moonLight.shadow.bias = -0.001;
    this.moonLight.shadow.needsUpdate = true;
    this.moonLight.shadow.autoUpdate = false; // Manual control for consistency
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target); // Add target to scene for proper world-space lighting

    // Create visible sun sphere - emissive for glow effect
    const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      fog: false // Don't be affected by fog
    });
    this.sunSphere = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sunSphere.renderOrder = 999; // Render on top
    this.scene.add(this.sunSphere);

    // Create visible moon sphere - slightly emissive
    const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
    const moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false // Don't be affected by fog
    });
    this.moonSphere = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonSphere.renderOrder = 999; // Render on top
    this.scene.add(this.moonSphere);

    // Initialize lighting positions
    this.updateDayNightCycle();
  }

  /**
   * Update the day/night cycle
   */
  private updateDayNightCycle(): void {
    // Convert time to radians for circular motion
    const angle = this.timeOfDay * Math.PI * 2;

    // Sun arc configuration - more realistic path
    const sunTilt = Math.PI / 4; // 45 degrees tilt for more pronounced seasonal arc
    const arcRotation = 0; // No rotation for now, will be controllable

    // Calculate sun position with better arc
    const orbitRadius = 150; // Much further away to avoid camera occlusion
    const verticalScale = 0.7; // Higher zenith for more overhead sun at noon
    const baseX = Math.sin(angle) * orbitRadius;
    const baseY = Math.cos(angle) * Math.cos(sunTilt) * orbitRadius * verticalScale;
    const baseZ = Math.cos(angle) * Math.sin(sunTilt) * orbitRadius;

    // Apply rotation around Y axis
    const sunX = baseX * Math.cos(arcRotation) - baseZ * Math.sin(arcRotation);
    const sunY = baseY;
    const sunZ = baseX * Math.sin(arcRotation) + baseZ * Math.cos(arcRotation);

    // Set sun position and make sphere follow
    this.sunLight.position.set(sunX, Math.max(0, sunY), sunZ);
    this.sunLight.visible = sunY > -5;

    // Position sun sphere exactly at light source
    this.sunSphere.position.set(sunX, sunY, sunZ); // Use actual position, even if below horizon
    this.sunSphere.visible = sunY > -10; // Show slightly below horizon for sunset effect

    // Make sun look at center for consistent lighting
    if (this.sunLight.visible) {
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();

      // Update shadow camera to be consistent with light direction
      // Shadow camera needs explicit update to work properly
      this.sunLight.shadow.camera.updateMatrixWorld(true);
      this.sunLight.shadow.needsUpdate = true;
    }

    // Update sun sphere appearance based on elevation
    if (this.sunSphere.visible) {
      const sunMat = this.sunSphere.material as THREE.MeshBasicMaterial;
      if (sunY < 10 && sunY > -10) {
        // Sunset/sunrise colors
        const factor = (sunY + 10) / 20;
        sunMat.color.setRGB(1.0, 0.6 + factor * 0.4, factor * 0.6);
      } else {
        sunMat.color.setHex(0xffd700);
      }
    }

    // Moon is opposite to sun
    const moonX = -sunX;
    const moonY = -sunY;
    const moonZ = -sunZ;

    // Set moon position and make sphere follow
    this.moonLight.position.set(moonX, Math.max(0, moonY), moonZ);
    this.moonLight.visible = moonY > -5;

    // Position moon sphere exactly at light source
    this.moonSphere.position.set(moonX, moonY, moonZ); // Use actual position, even if below horizon
    this.moonSphere.visible = moonY > -10; // Show slightly below horizon for moonrise effect

    // Make moon look at center for consistent lighting
    if (this.moonLight.visible) {
      this.moonLight.target.position.set(0, 0, 0);
      this.moonLight.target.updateMatrixWorld();

      // Update shadow camera to be consistent with light direction
      // Shadow camera needs explicit update to work properly
      this.moonLight.shadow.camera.updateMatrixWorld(true);
      this.moonLight.shadow.needsUpdate = true;
    }

    // Update moon sphere appearance based on elevation
    if (this.moonSphere.visible) {
      const moonMat = this.moonSphere.material as THREE.MeshBasicMaterial;
      const brightness = Math.max(0.7, (moonY + 10) / 20);
      moonMat.color.setRGB(brightness, brightness, brightness * 1.05);
    }

    // Adjust light intensities based on sun elevation
    const sunElevation = Math.max(0, sunY / (orbitRadius * verticalScale)); // 0 to 1
    const moonElevation = Math.max(0, moonY / (orbitRadius * verticalScale)); // 0 to 1

    // Sun intensity varies with elevation (reduced to prevent overexposure)
    this.sunLight.intensity = sunElevation * 1.0;

    // Moon intensity varies with elevation (dimmer)
    this.moonLight.intensity = moonElevation * 0.25;

    // Ambient light varies throughout the day
    // Brighter during day, darker at night
    const dayFactor = Math.max(0, Math.cos(angle)); // 1 at noon, -1 at midnight
    const ambientIntensity = 0.15 + dayFactor * 0.2; // 0.15 to 0.35 (reduced to prevent overexposure)
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

    // Update fog color based on time of day (toned down brightness)
    const fogDayColor = new THREE.Color(0x708090); // Day fog - muted gray-blue
    const fogNightColor = new THREE.Color(0x1a2030); // Night fog - very dark blue
    const fogSunsetColor = new THREE.Color(0x806050); // Sunset fog - muted warm tone

    // Calculate fog color based on sun position
    if (sunElevation > 0.5) {
      // Day time
      this.scene.fog!.color.copy(fogDayColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogDayColor);
      }
    } else if (sunElevation > 0 && sunElevation <= 0.3) {
      // Sunrise/sunset
      const sunsetFactor = sunElevation / 0.3;
      this.scene.fog!.color.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      }
    } else if (moonElevation > 0) {
      // Night time with moon
      this.scene.fog!.color.copy(fogNightColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogNightColor);
      }
    } else {
      // Twilight/dawn
      const twilightFactor = Math.max(Math.abs(sunElevation), Math.abs(moonElevation)) * 5;
      this.scene.fog!.color.lerpColors(fogNightColor, fogSunsetColor, twilightFactor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogNightColor, fogSunsetColor, twilightFactor);
      }
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

  /**
   * Create a data texture for simulation
   */
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
    this.terrainMesh.matrixAutoUpdate = true; // Ensure matrix updates
    this.scene.add(this.terrainMesh);

    // No need to update vertices - GPU handles displacement via heightTexture

    // Create ocean water plane at sea level (always visible)
    // Match terrain size exactly for proper alignment
    const oceanGeometry = new THREE.PlaneGeometry(
      this.terrainSize, // Match terrain size exactly
      this.terrainSize,
      128, // Higher resolution for better shore blending
      128
    );
    oceanGeometry.rotateX(-Math.PI / 2);

    const oceanMaterial = createWaterMaterialTSL({
      opacity: 0.9,
      heightTexture: this.heightTexture, // Pass height texture for depth calculation
      waterLevel: 2.25 / 15 // Normalized water level (2.25 units / 15 height scale)
    });

    this.oceanMesh = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.oceanMesh.position.y = 2.25; // Water level (0.15 normalized)
    this.oceanMesh.position.x = 0; // Ensure centered
    this.oceanMesh.position.z = 0; // Ensure centered
    this.oceanMesh.renderOrder = 1; // Render after terrain for proper blending
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
    // Generate a much more interesting island terrain with proper features
    const size = this.gridSize;
    const data = this.heightTexture.image.data as Float32Array;

    // Better hash function for noise
    const hash2 = (x: number, y: number): number => {
      let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return h - Math.floor(h);
    };

    // Smooth interpolation
    const smoothstep = (edge0: number, edge1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    // Improved Perlin-like noise
    const noise2D = (x: number, y: number, scale: number, octaves: number = 1): number => {
      let value = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;

      for (let i = 0; i < octaves; i++) {
        const sx = x * frequency;
        const sy = y * frequency;

        // Grid cell coordinates
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        // Interpolation weights
        const wx = sx - x0;
        const wy = sy - y0;

        // Random values at grid points
        const n00 = hash2(x0, y0);
        const n10 = hash2(x1, y0);
        const n01 = hash2(x0, y1);
        const n11 = hash2(x1, y1);

        // Bilinear interpolation
        const sx1 = smoothstep(0, 1, wx);
        const sy1 = smoothstep(0, 1, wy);

        const nx0 = n00 * (1 - sx1) + n10 * sx1;
        const nx1 = n01 * (1 - sx1) + n11 * sx1;
        const nxy = nx0 * (1 - sy1) + nx1 * sy1;

        value += nxy * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
      }

      return value / maxValue;
    };

    // Ridge noise for mountain chains
    const ridgeNoise = (x: number, y: number, scale: number, octaves: number = 1): number => {
      let value = 0;
      let amplitude = 1;
      let frequency = scale;
      let maxValue = 0;

      for (let i = 0; i < octaves; i++) {
        const n = noise2D(x, y, frequency, 1);
        // Create ridges by inverting and taking absolute value
        const ridge = 1 - Math.abs(n * 2 - 1);
        value += ridge * ridge * amplitude;

        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.3;
      }

      return value / maxValue;
    };

    // Voronoi-like cellular noise for interesting features
    const cellularNoise = (x: number, y: number, scale: number): number => {
      const cellX = Math.floor(x * scale);
      const cellY = Math.floor(y * scale);

      let minDist = 1;
      let secondDist = 1;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cellX + dx;
          const cy = cellY + dy;

          // Random point in cell
          const hash = Math.sin(cx * 127.3 + cy * 311.7) * 43758.5453;
          const px = cx + (hash - Math.floor(hash));
          const hash2 = Math.sin(hash * 127.3) * 43758.5453;
          const py = cy + (hash2 - Math.floor(hash2));

          const dist = Math.sqrt(Math.pow(x * scale - px, 2) + Math.pow(y * scale - py, 2));

          if (dist < minDist) {
            secondDist = minDist;
            minDist = dist;
          } else if (dist < secondDist) {
            secondDist = dist;
          }
        }
      }

      // Return difference for more interesting patterns
      return secondDist - minDist;
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;

        // Normalized coordinates (-1 to 1)
        const nx = (x / size) * 2 - 1;
        const ny = (y / size) * 2 - 1;

        // Distance from center with asymmetry
        const distX = nx * 1.1;
        const distY = ny * 0.9;
        const dist = Math.sqrt(distX * distX + distY * distY);

        // Start with zero height
        let height = 0;

        // Create main island shape with more organic variation
        const shapeNoise = noise2D(nx * 0.7, ny * 0.7, 2, 3);
        const islandShape = Math.max(0, 1 - dist * (1.0 + shapeNoise * 0.4));
        const islandNoise = noise2D(nx, ny, 3, 4);
        const islandMask = Math.pow(islandShape, 0.6) * (0.6 + islandNoise * 0.4);

        if (islandMask > 0.01) {
          // Base elevation with extended smooth underwater-to-beach transition
          if (islandMask < 0.05) {
            // Deep underwater approach with very gradual slope
            height = 0.03 + islandMask * 1.6;
          } else if (islandMask < 0.12) {
            // Mid-depth underwater with smooth rise
            const midProgress = (islandMask - 0.05) / 0.07;
            const smoothProgress = smoothstep(0, 1, midProgress);
            height = 0.11 + smoothProgress * 0.03;
          } else if (islandMask < 0.2) {
            // Shallow water approaching beach
            const shallowProgress = (islandMask - 0.12) / 0.08;
            const smoothProgress = smoothstep(0, 1, shallowProgress);
            height = 0.14 + smoothProgress * 0.012;
          } else if (islandMask < 0.35) {
            // Extended beach zone with ultra-gentle slope using cosine
            const beachProgress = (islandMask - 0.2) / 0.15;
            const cosineProgress = (1 - Math.cos(beachProgress * Math.PI)) * 0.5;
            height = 0.152 + cosineProgress * 0.018;
          } else {
            // Above beach - varied terrain
            height = 0.17 + islandMask * 0.08;
          }

          // Add terrain features based on zones
          const cellNoise = cellularNoise(nx + 0.5, ny + 0.5, 5);

          // Mountain ranges using ridge noise
          const mountainZone = Math.max(0, islandMask - 0.35);
          if (mountainZone > 0 && ny > -0.3) {  // Mountains mostly in north
            // Use ridge noise for realistic mountain chains
            const ridges = ridgeNoise(nx * 1.5, ny * 1.5, 4, 3);

            // Create distinct peaks
            const peak1 = Math.exp(-((nx - 0.2) * (nx - 0.2) + (ny - 0.3) * (ny - 0.3)) * 15);
            const peak2 = Math.exp(-((nx + 0.15) * (nx + 0.15) + (ny - 0.2) * (ny - 0.2)) * 20);
            const peak3 = Math.exp(-((nx) * (nx) + (ny - 0.4) * (ny - 0.4)) * 12);

            const peaks = (peak1 + peak2 * 0.8 + peak3 * 0.6) * mountainZone;
            const mountains = ridges * mountainZone * 0.25 + peaks * 0.35;

            height += mountains;

            // Add rocky outcrops using cellular noise
            if (cellNoise > 0.15 && mountainZone > 0.1) {
              height += cellNoise * mountainZone * 0.1;
            }
          }

          // Create flat meadow areas and plateaus
          const meadowZone1 = islandMask > 0.25 && islandMask < 0.4 &&
                             Math.abs(nx + 0.2) < 0.3 && Math.abs(ny + 0.1) < 0.2;
          const meadowZone2 = islandMask > 0.3 && islandMask < 0.45 &&
                             Math.abs(nx - 0.25) < 0.2 && Math.abs(ny + 0.3) < 0.15;

          if (meadowZone1 || meadowZone2) {
            // Flatten these areas for meadows with slight undulation
            const meadowBase = meadowZone1 ? 0.21 : 0.24;
            const gentleNoise = noise2D(nx * 8, ny * 8, 15, 1);
            height = meadowBase + gentleNoise * 0.008;
          }

          // Create organic lagoon with varied depth
          const lagoonX = 0.15;
          const lagoonY = -0.05;
          const lagoonDist = Math.sqrt(Math.pow(nx - lagoonX, 2) + Math.pow(ny - lagoonY, 2));
          const lagoonAngle = Math.atan2(ny - lagoonY, nx - lagoonX);
          const lagoonRadius = 0.12 + Math.sin(lagoonAngle * 2.5) * 0.04 + Math.cos(lagoonAngle * 4) * 0.02;

          if (lagoonDist < lagoonRadius && islandMask > 0.15) {
            const lagoonDepth = smoothstep(lagoonRadius, 0, lagoonDist);
            const depthVariation = noise2D(nx * 10, ny * 10, 20, 1);
            height -= lagoonDepth * (0.06 + depthVariation * 0.02);

            // Ensure lagoon stays slightly below water but not too deep
            height = Math.max(height, 0.10);
            height = Math.min(height, 0.135);  // Keep it as a shallow lagoon
          }

          // Create dramatic cliffs on western side
          if (nx < -0.3 && islandMask > 0.25) {
            const cliffStrength = smoothstep(-0.3, -0.6, nx);
            const cliffNoise = noise2D(ny * 5, nx * 5, 10, 2);

            // Sharp elevation change for cliff
            if (cliffStrength > 0.1) {
              height = Math.max(height, 0.25 + cliffStrength * 0.2 + cliffNoise * 0.05);
            }

            // Rocky texture on cliff face
            if (cliffStrength > 0.3) {
              height += cellNoise * cliffStrength * 0.08;
            }
          }

          // Add erosion-like details
          const erosionNoise = noise2D(nx * 12, ny * 12, 25, 3);
          const erosionStrength = Math.max(0, islandMask - 0.2) * (1 - mountainZone);
          height += erosionNoise * 0.015 * erosionStrength;

          // Create river valleys
          const valley1 = Math.exp(-Math.pow((nx - ny * 0.3 + 0.1), 2) * 30) * islandMask;
          const valley2 = Math.exp(-Math.pow((nx * 0.5 + ny - 0.2), 2) * 25) * islandMask;

          if ((valley1 > 0.1 || valley2 > 0.1) && height > 0.16) {
            const valleyDepth = Math.max(valley1, valley2);
            height -= valleyDepth * 0.03;
            height = Math.max(height, 0.145);  // Don't go below beach level
          }
        }

        // Add smaller satellite islands with more character
        // Rocky outcrop to the northeast
        const island1X = 0.4;
        const island1Y = 0.35;
        const island1Dist = Math.sqrt(Math.pow(nx - island1X, 2) + Math.pow(ny - island1Y, 2));
        if (island1Dist < 0.1) {
          const island1Factor = Math.pow(1 - island1Dist / 0.1, 1.2);
          const rockiness = cellularNoise((nx - island1X) * 10, (ny - island1Y) * 10, 8);
          const island1Height = 0.146 + island1Factor * (0.12 + rockiness * 0.08);
          height = Math.max(height, island1Height);
        }

        // Sandy atoll chain to the southwest
        const atoll1X = -0.45;
        const atoll1Y = -0.2;
        const atoll2X = -0.38;
        const atoll2Y = -0.32;

        const atoll1Dist = Math.sqrt(Math.pow(nx - atoll1X, 2) + Math.pow(ny - atoll1Y, 2));
        const atoll2Dist = Math.sqrt(Math.pow(nx - atoll2X, 2) + Math.pow(ny - atoll2Y, 2));

        if (atoll1Dist < 0.06) {
          const atollFactor = smoothstep(0.06, 0, atoll1Dist);
          const sandNoise = noise2D(nx * 15, ny * 15, 30, 1);
          height = Math.max(height, 0.141 + atollFactor * 0.02 + sandNoise * 0.003);
        }

        if (atoll2Dist < 0.05) {
          const atollFactor = smoothstep(0.05, 0, atoll2Dist);
          height = Math.max(height, 0.142 + atollFactor * 0.018);
        }

        // Ocean floor with underwater features
        if (height < 0.1) {
          const oceanNoise = noise2D(nx * 3, ny * 3, 6, 3);
          const underwaterRidge = ridgeNoise(nx * 2, ny * 2, 5, 2);

          // Create underwater channels and ridges
          const baseDepth = 0.02 + oceanNoise * 0.04;
          const ridgeHeight = underwaterRidge * 0.03 * (1 - islandMask);

          height = Math.max(height, baseDepth + ridgeHeight);

          // Deep ocean trenches
          const trenchX = Math.sin(ny * 3) * 0.1;
          const trenchDist = Math.abs(nx - 0.7 - trenchX);
          if (trenchDist < 0.05 && dist > 0.6) {
            height *= 0.3;
          }
        }

        // Final clamping
        height = Math.max(0, Math.min(1, height));

        // Set all channels to the same height value
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
    // GPU will automatically use updated texture for displacement
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

    // Show/hide water mesh based on whether there's water
    if (this.waterMesh) {
      const hasWater = data.some((v) => v > 0.01);
      this.waterMesh.visible = hasWater;
    }
  }

  public updateLavaDepth(data: Float32Array): void {
    const textureData = this.lavaDepthTexture.image.data as Float32Array;
    textureData.set(data);
    this.lavaDepthTexture.needsUpdate = true;

    // Show/hide lava mesh based on whether there's lava
    if (this.lavaMesh) {
      const hasLava = data.some((v) => v > 0.01);
      this.lavaMesh.visible = hasLava;
    }
  }

  public updateTemperature(data: Float32Array): void {
    const textureData = this.temperatureTexture.image.data as Float32Array;
    textureData.set(data);
    this.temperatureTexture.needsUpdate = true;
  }

  /**
   * Set which debug visualization to show
   */
  public setDebugMode(mode: number): void {
    // Debug mode implementation would go here
    // This would switch between different visualization modes
    console.log('Setting debug mode:', mode);
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
    // Update controls first (camera movement)
    this.controls.update();

    // Update day/night cycle if active (independent of camera)
    if (this.dayNightCycleActive) {
      this.timeOfDay += this.cycleSpeed;
      if (this.timeOfDay > 1) {
        this.timeOfDay -= 1;
      }
      this.updateDayNightCycle();
    }

    // Render the scene
    super.render();
  }

  public override dispose(): void {
    // Clean up event listeners
    if ((this as any)._keyHandlers) {
      const { handleKeyDown, handleKeyUp } = (this as any)._keyHandlers;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    }

    // Dispose of controls
    this.controls.dispose();

    // Dispose of textures
    this.heightTexture.dispose();
    this.flowTexture.dispose();
    this.accumulationTexture.dispose();
    this.waterDepthTexture.dispose();
    this.lavaDepthTexture.dispose();
    this.temperatureTexture.dispose();

    // Dispose of meshes
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }
    if (this.waterMesh) {
      this.waterMesh.geometry.dispose();
      (this.waterMesh.material as THREE.Material).dispose();
    }
    // Ocean mesh cleanup removed
    if (this.lavaMesh) {
      this.lavaMesh.geometry.dispose();
      (this.lavaMesh.material as THREE.Material).dispose();
    }

    super.dispose();
  }
}