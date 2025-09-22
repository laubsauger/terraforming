import * as THREE from 'three/webgpu';

export interface DayNightCycleManagerOptions {
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
}

export class DayNightCycleManager {
  private scene: THREE.Scene;
  private renderer: THREE.WebGPURenderer;

  // Lighting
  private sunLight!: THREE.DirectionalLight;
  private moonLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private sunSphere!: THREE.Mesh;
  private moonSphere!: THREE.Mesh;

  // Time settings
  private timeOfDay = 0.35; // Start at 9:30 AM
  private dayNightCycleActive = false;
  private cycleSpeed = 0.0001;

  constructor(options: DayNightCycleManagerOptions) {
    this.scene = options.scene;
    this.renderer = options.renderer;
    this.setupLighting();
  }

  private createSkyGradientTexture(): THREE.CubeTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const gradient = ctx.createLinearGradient(0, size, 0, 0);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(0.4, '#4682B4');
    gradient.addColorStop(0.7, '#191970');
    gradient.addColorStop(1, '#000033');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const faces = [];
    for (let i = 0; i < 6; i++) {
      faces.push(canvas);
    }

    const cubeTexture = new THREE.CubeTexture(faces);
    cubeTexture.needsUpdate = true;
    cubeTexture.format = THREE.RGBAFormat;
    cubeTexture.generateMipmaps = false;
    cubeTexture.minFilter = THREE.LinearFilter;
    cubeTexture.magFilter = THREE.LinearFilter;

    return cubeTexture;
  }

  private setupLighting(): void {
    // Enable shadow mapping on renderer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Ambient light
    this.ambientLight = new THREE.AmbientLight(0xfff5e6, 0.2);
    this.scene.add(this.ambientLight);

    // Environment map for water reflections
    const gradientTexture = this.createSkyGradientTexture();
    this.scene.environment = gradientTexture;

    // Sun light
    this.sunLight = new THREE.DirectionalLight(0xfff8e1, 2.5);
    this.sunLight.castShadow = true;

    // Configure sun shadow camera
    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 300;
    this.sunLight.shadow.camera.left = -80;
    this.sunLight.shadow.camera.right = 80;
    this.sunLight.shadow.camera.top = 80;
    this.sunLight.shadow.camera.bottom = -80;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.sunLight.shadow.needsUpdate = true;
    this.sunLight.shadow.autoUpdate = true;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Moon light
    this.moonLight = new THREE.DirectionalLight(0x6080ff, 0.25);
    this.moonLight.castShadow = true;

    // Configure moon shadow camera
    this.moonLight.shadow.mapSize.width = 2048;
    this.moonLight.shadow.mapSize.height = 2048;
    this.moonLight.shadow.camera.near = 10;
    this.moonLight.shadow.camera.far = 200;
    this.moonLight.shadow.camera.left = -60;
    this.moonLight.shadow.camera.right = 60;
    this.moonLight.shadow.camera.top = 60;
    this.moonLight.shadow.camera.bottom = -60;
    this.moonLight.shadow.bias = -0.001;
    this.moonLight.shadow.normalBias = 0.02;
    this.moonLight.shadow.needsUpdate = true;
    this.moonLight.shadow.autoUpdate = true;
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    // Create visible sun sphere
    const sunGeometry = new THREE.SphereGeometry(8, 32, 32);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      fog: false
    });
    this.sunSphere = new THREE.Mesh(sunGeometry, sunMaterial);
    this.sunSphere.renderOrder = 999;
    this.scene.add(this.sunSphere);

    // Create visible moon sphere
    const moonGeometry = new THREE.SphereGeometry(6, 32, 32);
    const moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false
    });
    this.moonSphere = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moonSphere.renderOrder = 999;
    this.scene.add(this.moonSphere);

    // Initialize lighting positions
    this.updateCycle();
  }

  public updateCycle(): void {
    // Remap time to favor daytime
    let adjustedTime = this.timeOfDay;

    if (adjustedTime < 0.1) {
      adjustedTime = adjustedTime * 2.0;
    } else if (adjustedTime < 0.15) {
      adjustedTime = 0.2 + (adjustedTime - 0.1) * (0.05 / 0.05);
    } else if (adjustedTime < 0.85) {
      adjustedTime = 0.25 + (adjustedTime - 0.15) * (0.5 / 0.7);
    } else if (adjustedTime < 0.9) {
      adjustedTime = 0.75 + (adjustedTime - 0.85) * (0.05 / 0.05);
    } else {
      adjustedTime = 0.8 + (adjustedTime - 0.9) * (0.2 / 0.1);
    }

    const angle = adjustedTime * Math.PI * 2;
    const arcRotation = Math.PI / 8;

    const orbitRadius = 120;
    const verticalScale = 0.6;
    const maxElevation = Math.PI / 3;

    const elevationAngle = Math.min(maxElevation, Math.abs(-Math.cos(angle)) * (Math.PI / 2));

    const azimuth = angle + arcRotation;
    const baseX = Math.sin(azimuth) * orbitRadius * Math.cos(elevationAngle);
    const baseY = Math.sin(elevationAngle) * orbitRadius * verticalScale;
    const baseZ = Math.cos(azimuth) * orbitRadius * Math.cos(elevationAngle);

    const sunX = baseX;
    const sunY = baseY;
    const sunZ = baseZ;

    // Set sun position
    this.sunLight.position.set(sunX, Math.max(0, sunY), sunZ);
    this.sunLight.visible = sunY > -5;

    this.sunSphere.position.set(sunX, sunY, sunZ);
    this.sunSphere.visible = sunY > -10;

    if (this.sunLight.visible) {
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();
      this.sunLight.updateMatrixWorld();
      this.sunLight.shadow.needsUpdate = true;
      this.sunLight.shadow.camera.updateMatrixWorld();
      this.sunLight.shadow.camera.updateProjectionMatrix();
    }

    // Update sun sphere appearance
    if (this.sunSphere.visible) {
      const sunMat = this.sunSphere.material as THREE.MeshBasicMaterial;
      if (sunY < 10 && sunY > -10) {
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

    // Set moon position
    this.moonLight.position.set(moonX, Math.max(0, moonY), moonZ);
    this.moonLight.visible = moonY > -5;

    this.moonSphere.position.set(moonX, moonY, moonZ);
    this.moonSphere.visible = moonY > -10;

    if (this.moonLight.visible) {
      this.moonLight.target.position.set(0, 0, 0);
      this.moonLight.target.updateMatrixWorld();
      this.moonLight.updateMatrixWorld();
      this.moonLight.shadow.needsUpdate = true;
      this.moonLight.shadow.camera.updateMatrixWorld();
      this.moonLight.shadow.camera.updateProjectionMatrix();
    }

    // Update moon sphere appearance
    if (this.moonSphere.visible) {
      const moonMat = this.moonSphere.material as THREE.MeshBasicMaterial;
      const brightness = Math.max(0.7, (moonY + 10) / 20);
      moonMat.color.setRGB(brightness, brightness, brightness * 1.05);
    }

    // Calculate lighting intensities
    const sunElevation = Math.max(0, Math.sin(elevationAngle));
    const moonElevation = Math.max(0, moonY / (orbitRadius * verticalScale));
    const isDaytime = sunElevation > 0.1;

    if (isDaytime) {
      const dayIntensity = Math.max(0.4, sunElevation * 2.5);
      this.sunLight.intensity = dayIntensity;
      this.sunLight.castShadow = true;
      this.moonLight.intensity = 0.02;
      this.moonLight.castShadow = false;
    } else {
      this.sunLight.intensity = 0.02;
      this.sunLight.castShadow = false;
      this.moonLight.intensity = moonElevation * 0.3;
      this.moonLight.castShadow = true;
    }

    // Ambient light varies throughout the day
    const dayFactor = Math.max(0, Math.cos(angle));
    const ambientIntensity = 0.02 + dayFactor * 0.05;
    this.ambientLight.intensity = ambientIntensity;

    // Adjust ambient color
    const twilightFactor = Math.abs(Math.sin(angle * 2)) * (1 - Math.abs(dayFactor));
    const ambientR = 1.0;
    const ambientG = 1.0 - twilightFactor * 0.2;
    const ambientB = 1.0 - twilightFactor * 0.4;
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
      this.sunLight.color.setHex(0xfffaed);
    }

    // Update fog color
    const fogDayColor = new THREE.Color(0x0a0a0a);
    const fogNightColor = new THREE.Color(0x000000);
    const fogSunsetColor = new THREE.Color(0x050505);

    if (sunElevation > 0.5) {
      this.scene.fog!.color.copy(fogDayColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogDayColor);
      }
    } else if (sunElevation > 0 && sunElevation <= 0.3) {
      const sunsetFactor = sunElevation / 0.3;
      this.scene.fog!.color.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogSunsetColor, fogDayColor, sunsetFactor);
      }
    } else if (moonElevation > 0) {
      this.scene.fog!.color.copy(fogNightColor);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(fogNightColor);
      }
    } else {
      const twilightFactorCalc = Math.max(Math.abs(sunElevation), Math.abs(moonElevation)) * 5;
      this.scene.fog!.color.lerpColors(fogNightColor, fogSunsetColor, twilightFactorCalc);
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.lerpColors(fogNightColor, fogSunsetColor, twilightFactorCalc);
      }
    }
  }

  public update(): void {
    if (this.dayNightCycleActive) {
      this.timeOfDay += this.cycleSpeed;
      if (this.timeOfDay > 1) {
        this.timeOfDay -= 1;
      }
      this.updateCycle();
    }
  }

  public setTimeOfDay(time: number): void {
    this.timeOfDay = time % 1;
    this.updateCycle();
  }

  public setDayNightCycleActive(active: boolean): void {
    this.dayNightCycleActive = active;
  }

  public setCycleSpeed(speed: number): void {
    this.cycleSpeed = speed;
  }

  public dispose(): void {
    // Lights don't need explicit disposal as they're removed with the scene
  }
}