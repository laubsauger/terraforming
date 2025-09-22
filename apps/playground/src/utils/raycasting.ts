import * as THREE from 'three';
import type { Engine } from '@terraforming/engine';

export interface RaycastResult {
  point: THREE.Vector3;
  terrainHeight: number;
  normal: THREE.Vector3;
  distance: number;
}

interface RaycastCache {
  frameTime: number;
  mouseX: number;
  mouseY: number;
  result: RaycastResult | null;
}

// Shared raycaster instance
const sharedRaycaster = new THREE.Raycaster();
// Cache to avoid multiple raycasts per frame
let raycastCache: RaycastCache | null = null;

/**
 * Perform a raycast from camera through mouse position to terrain
 * Results are cached per frame to avoid duplicate calculations
 */
export function raycastToTerrain(
  engine: Engine,
  canvasElement: HTMLCanvasElement,
  mousePosition: { x: number; y: number }
): RaycastResult | null {
  const camera = engine.getCamera();
  const terrainMesh = engine.getTerrainMesh();

  if (!camera || !terrainMesh || !canvasElement) {
    return null;
  }

  // Check cache first - if same frame and mouse position, return cached result
  const currentFrame = performance.now();
  if (raycastCache &&
      Math.abs(raycastCache.frameTime - currentFrame) < 16 && // Within same frame (~60fps)
      raycastCache.mouseX === mousePosition.x &&
      raycastCache.mouseY === mousePosition.y) {
    return raycastCache.result;
  }

  // Convert mouse position to normalized device coordinates
  const rect = canvasElement.getBoundingClientRect();
  const ndcX = ((mousePosition.x - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((mousePosition.y - rect.top) / rect.height) * 2 + 1;

  // Update raycaster
  sharedRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  // Intersect with terrain mesh
  const intersects = sharedRaycaster.intersectObject(terrainMesh, false);

  let result: RaycastResult | null = null;

  if (intersects.length > 0) {
    const hitPoint = intersects[0].point;

    // Get accurate terrain height at this position
    const terrainHeight = engine.getTerrainHeightAt(hitPoint.x, hitPoint.z);

    if (terrainHeight !== null) {
      // Calculate terrain normal
      const normal = getTerrainNormal(engine, hitPoint.x, hitPoint.z);

      result = {
        point: new THREE.Vector3(hitPoint.x, terrainHeight, hitPoint.z),
        terrainHeight,
        normal,
        distance: intersects[0].distance
      };
    }
  }

  // If no direct hit, try ray marching as fallback
  if (!result) {
    const rayOrigin = sharedRaycaster.ray.origin;
    const rayDirection = sharedRaycaster.ray.direction;

    const maxDistance = 300;
    const stepSize = 0.5;

    for (let distance = 0; distance < maxDistance; distance += stepSize) {
      const testPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(distance));

      // Check bounds
      if (Math.abs(testPoint.x) > 50 || Math.abs(testPoint.z) > 50) continue;

      const terrainHeight = engine.getTerrainHeightAt(testPoint.x, testPoint.z);

      if (terrainHeight !== null && testPoint.y <= terrainHeight + 1) {
        const normal = getTerrainNormal(engine, testPoint.x, testPoint.z);

        result = {
          point: new THREE.Vector3(testPoint.x, terrainHeight, testPoint.z),
          terrainHeight,
          normal,
          distance
        };
        break;
      }
    }
  }

  // Update cache
  raycastCache = {
    frameTime: currentFrame,
    mouseX: mousePosition.x,
    mouseY: mousePosition.y,
    result
  };

  return result;
}

/**
 * Calculate terrain normal at a given position
 */
export function getTerrainNormal(engine: Engine, x: number, z: number): THREE.Vector3 {
  const epsilon = 0.5;

  // Sample heights around the point
  const h0 = engine.getTerrainHeightAt(x, z) || 0;
  const hX1 = engine.getTerrainHeightAt(x + epsilon, z) || 0;
  const hX2 = engine.getTerrainHeightAt(x - epsilon, z) || 0;
  const hZ1 = engine.getTerrainHeightAt(x, z + epsilon) || 0;
  const hZ2 = engine.getTerrainHeightAt(x, z - epsilon) || 0;

  // Calculate gradient (slope)
  const dx = (hX1 - hX2) / (2 * epsilon);
  const dz = (hZ1 - hZ2) / (2 * epsilon);

  // Create normal vector from gradient
  const normal = new THREE.Vector3(-dx, 1, -dz);
  normal.normalize();

  return normal;
}

/**
 * Clear the raycast cache (call when mouse moves or frame changes)
 */
export function clearRaycastCache(): void {
  raycastCache = null;
}