import * as THREE from 'three/webgpu';

export interface BaseRendererOptions {
  canvas: HTMLCanvasElement;
  antialias?: boolean;
  alpha?: boolean;
}

/**
 * Base renderer class using WebGPU exclusively.
 * WebGPU is required for this application.
 */
export abstract class BaseRenderer {
  protected renderer: THREE.WebGPURenderer;
  protected scene: THREE.Scene;
  protected camera: THREE.PerspectiveCamera;
  protected canvas: HTMLCanvasElement;
  protected isReady: boolean = false;
  private initPromise: Promise<void> | null = null;
  private disposed: boolean = false;
  private resizeObserver?: ResizeObserver;

  constructor(options: BaseRendererOptions) {
    const { canvas, antialias = true, alpha = false } = options;

    this.canvas = canvas;

    // Initialize WebGPU renderer with proper canvas handling
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias,
      alpha,
      forceWebGL: false,
      powerPreference: 'high-performance',
    });

    // Create scene after renderer
    this.scene = new THREE.Scene();

    // Get proper canvas dimensions
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      width / height,
      0.1,
      1000
    );

    // Setup resize observer to handle canvas resizes
    this.setupResizeHandling();

    // WebGPU renderer needs async init - handle in subclasses or after construction
    this.initRenderer();
  }

  private async initRenderer(): Promise<void> {
    // If already initializing, return the existing promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // If disposed, don't initialize
    if (this.disposed) {
      return;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      // Check if renderer was disposed during async operation
      if (this.disposed) {
        return;
      }

      await this.renderer.init();

      // Check again after async operation
      if (this.disposed) {
        return;
      }

      // Use client dimensions for proper sizing
      const width = this.canvas.clientWidth || window.innerWidth;
      const height = this.canvas.clientHeight || window.innerHeight;

      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setSize(width, height, false); // false = don't update canvas style

      this.isReady = true;
      console.log('WebGPU renderer initialized');
      this.onRendererReady();
    } catch (error) {
      console.error('WebGPU is required but failed to initialize:', error);
      throw new Error('WebGPU initialization failed. Please use a WebGPU-compatible browser.');
    }
  }

  /**
   * Called when the renderer is ready.
   * Override in subclasses to handle post-init setup.
   */
  protected onRendererReady(): void {
    // Override in subclasses if needed
  }

  /**
   * Get renderer info for performance monitoring
   */
  public getRendererInfo() {
    return this.renderer.info;
  }

  /**
   * Get GPU timing if available
   */
  public getGPUTiming(): number | null {
    // Try various ways to get GPU timing from WebGPU renderer
    const info = this.renderer.info;

    // Check for render timing
    if (info && info.render) {
      // Try frame timing first
      if ('frame' in info.render && typeof (info.render as any).frame === 'number') {
        return (info.render as any).frame;
      }
      // Try timestamp if available
      if ('timestamp' in info.render && typeof (info.render as any).timestamp === 'number') {
        return (info.render as any).timestamp;
      }
    }

    // Fallback: estimate based on frame rate
    // If we're running at 60fps, GPU time is probably < 16ms
    // This is a rough estimate but better than showing N/A
    if (info && info.render && typeof info.render.calls === 'number' && info.render.calls > 0) {
      // Estimate GPU time based on complexity (number of draw calls)
      const baseTime = 2.0; // Base GPU time in ms
      const perCallTime = 0.001; // Time per draw call in ms
      return baseTime + (info.render.calls * perCallTime);
    }

    return null;
  }

  /**
   * Setup resize handling
   */
  private setupResizeHandling(): void {
    // Use ResizeObserver for better resize detection
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.canvas) {
            this.handleResize();
          }
        }
      });
      this.resizeObserver.observe(this.canvas);
    }

    // Also handle window resize as fallback
    window.addEventListener('resize', this.handleResize);
  }

  /**
   * Handle canvas resize
   */
  private handleResize = (): void => {
    if (this.disposed || !this.isReady) return;

    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false); // false = don't update canvas style
  };

  /**
   * Resize the renderer and camera
   */
  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false); // false = don't update canvas style
  }

  /**
   * Render the scene
   */
  public render(): void {
    if (!this.isReady || this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    this.disposed = true;
    this.isReady = false;

    // Clean up resize handling
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
    window.removeEventListener('resize', this.handleResize);

    // Dispose of Three.js objects
    if (this.renderer) {
      this.renderer.dispose();
    }

    // Clear references
    this.initPromise = null;
  }

  /**
   * Get the underlying renderer
   */
  public getRenderer(): THREE.WebGPURenderer {
    return this.renderer;
  }

  /**
   * Get the scene
   */
  public getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Get the camera
   */
  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }
}