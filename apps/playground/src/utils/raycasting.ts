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

  // Always use ray marching for accurate displaced terrain intersection
  // This ensures we find the FIRST intersection with the actual displaced surface
  const rayOrigin = sharedRaycaster.ray.origin.clone();
  const rayDirection = sharedRaycaster.ray.direction.clone();

  // Start ray marching from camera position
  const maxDistance = 300;
  let stepSize = 2.0; // Start with larger steps for efficiency
  let lastAboveGround = true;
  let foundHit = false;

  for (let distance = 0; distance < maxDistance && !foundHit; distance += stepSize) {
    const testPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(distance));

    // Skip if outside terrain bounds
    if (Math.abs(testPoint.x) > 50 || Math.abs(testPoint.z) > 50) {
      continue;
    }

    const terrainHeight = engine.getTerrainHeightAt(testPoint.x, testPoint.z);
    if (terrainHeight === null) continue;

    const isAboveGround = testPoint.y > terrainHeight;

    // Check if we crossed the terrain surface
    if (lastAboveGround && !isAboveGround) {
      // We've crossed the surface - refine with binary search
      let low = Math.max(0, distance - stepSize);
      let high = distance;

      // Binary search for exact intersection
      for (let i = 0; i < 10; i++) {
        const mid = (low + high) / 2;
        const midPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(mid));
        const midHeight = engine.getTerrainHeightAt(midPoint.x, midPoint.z);

        if (midHeight !== null) {
          if (Math.abs(midPoint.y - midHeight) < 0.05) {
            // Found accurate intersection
            const normal = getTerrainNormal(engine, midPoint.x, midPoint.z);
            result = {
              point: new THREE.Vector3(midPoint.x, midHeight, midPoint.z),
              terrainHeight: midHeight,
              normal,
              distance: mid
            };
            foundHit = true;
            break;
          }

          if (midPoint.y > midHeight) {
            low = mid;
          } else {
            high = mid;
          }
        }
      }

      if (!foundHit) {
        // Use the refined position even if not exact
        const finalDist = (low + high) / 2;
        const finalPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(finalDist));
        const finalHeight = engine.getTerrainHeightAt(finalPoint.x, finalPoint.z);
        if (finalHeight !== null) {
          const normal = getTerrainNormal(engine, finalPoint.x, finalPoint.z);
          result = {
            point: new THREE.Vector3(finalPoint.x, finalHeight, finalPoint.z),
            terrainHeight: finalHeight,
            normal,
            distance: finalDist
          };
          foundHit = true;
        }
      }
    }

    lastAboveGround = isAboveGround;

    // Adaptive step size - smaller steps when close to terrain
    const distToSurface = Math.abs(testPoint.y - terrainHeight);
    if (distToSurface < 5) {
      stepSize = Math.min(stepSize, 0.5);
    } else if (distToSurface < 10) {
      stepSize = Math.min(stepSize, 1.0);
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