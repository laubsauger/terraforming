import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { InteractionTool } from './InteractionToolbar';
import { TOOL_COLORS } from './ToolCursor';
import type { Engine } from '@terraforming/engine';
import { raycastToTerrain } from '@playground/utils/raycasting';

interface TerrainCursorProps {
  activeTool: InteractionTool;
  brushSize: number;
  isVisible: boolean;
  engine: Engine | null;
  mousePosition: { x: number; y: number };
  canvasElement: HTMLCanvasElement | null;
  isAltPressed: boolean;
  handMass?: number;
  handCapacity?: number;
  brushMode?: 'pickup' | 'deposit';
}

export function TerrainCursor({
  activeTool,
  brushSize,
  isVisible,
  engine,
  mousePosition,
  canvasElement,
  isAltPressed,
  handMass = 0,
  handCapacity = 100000000,
  brushMode = 'pickup'
}: TerrainCursorProps) {
  const cursorGroupRef = useRef<THREE.Group | null>(null);
  const lastValidPositionRef = useRef<THREE.Vector3 | null>(null);
  const blockedIndicatorRef = useRef<THREE.Group | null>(null);
  const trailRef = useRef<THREE.Points | null>(null);
  const trailPositionsRef = useRef<THREE.Vector3[]>([]);
  const trailOpacitiesRef = useRef<number[]>([]);

  // Initialize cursor group when engine is ready
  useEffect(() => {
    const scene = engine?.getScene();
    if (!scene) return;

    // Create a group to hold cursor elements
    const group = new THREE.Group();

    // Create cursor as a circle of segments that can deform to terrain
    const segments = 64;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * brushSize;
      const z = Math.sin(angle) * brushSize;
      points.push(new THREE.Vector3(x, 0, z));
    }

    // Add a center dot for precision (add this first so it's child[0])
    const dotGeometry = new THREE.SphereGeometry(0.3, 8, 8); // Slightly bigger dot
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.8 : 0.6, // Muted by default
      depthTest: false,
    });
    const centerDot = new THREE.Mesh(dotGeometry, dotMaterial);
    centerDot.renderOrder = 1001;
    group.add(centerDot);

    // Create line geometry for cursor outline (add this second so it's child[1])
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: activeTool === 'select' ? 0.8 : 0.6, // Muted by default
      linewidth: activeTool === 'select' ? 3 : 8, // Much thicker lines for better visibility
      depthTest: false,
      depthWrite: false,
    });

    const cursorLine = new THREE.Line(geometry, material);
    cursorLine.renderOrder = 1000;
    group.add(cursorLine);

    // Add a filled circle for better visibility (child[2])
    const fillGeometry = new THREE.RingGeometry(0, brushSize, 64);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: parseInt(TOOL_COLORS[activeTool].replace('#', '0x')),
      transparent: true,
      opacity: 0.05, // Very subtle fill
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.renderOrder = 999;
    fillMesh.rotation.x = -Math.PI / 2; // Make it horizontal
    group.add(fillMesh);

    // Add blocked indicator (red X) for when at capacity (child[3])
    const blockedGroup = new THREE.Group();

    // Create X shape with two crossed lines
    const lineLength = brushSize * 0.8;
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xff0000, // Red
      transparent: true,
      opacity: 0.8,
      linewidth: 5,
      depthTest: false,
      depthWrite: false,
    });

    // First diagonal line
    const line1Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-lineLength/2, 0.1, -lineLength/2),
      new THREE.Vector3(lineLength/2, 0.1, lineLength/2)
    ]);
    const line1 = new THREE.Line(line1Geometry, lineMaterial);
    line1.renderOrder = 1002;
    blockedGroup.add(line1);

    // Second diagonal line
    const line2Geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-lineLength/2, 0.1, lineLength/2),
      new THREE.Vector3(lineLength/2, 0.1, -lineLength/2)
    ]);
    const line2 = new THREE.Line(line2Geometry, lineMaterial.clone());
    line2.renderOrder = 1002;
    blockedGroup.add(line2);

    // Add a circle around the X
    const blockedCircleGeometry = new THREE.RingGeometry(brushSize * 0.6, brushSize * 0.65, 32);
    const blockedCircleMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const blockedCircle = new THREE.Mesh(blockedCircleGeometry, blockedCircleMaterial);
    blockedCircle.rotation.x = -Math.PI / 2;
    blockedCircle.renderOrder = 1001;
    blockedGroup.add(blockedCircle);

    blockedGroup.visible = false;
    group.add(blockedGroup);
    blockedIndicatorRef.current = blockedGroup;

    // Create glowing trail effect
    const trailLength = 20; // Number of trail points
    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(trailLength * 3);
    const trailColors = new Float32Array(trailLength * 3);
    const trailSizes = new Float32Array(trailLength);

    // Initialize trail with current position
    for (let i = 0; i < trailLength; i++) {
      trailPositions[i * 3] = 0;
      trailPositions[i * 3 + 1] = 0;
      trailPositions[i * 3 + 2] = 0;

      // Color based on tool (with fade)
      const opacity = (i / trailLength) * 0.8;
      const toolColor = new THREE.Color(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
      trailColors[i * 3] = toolColor.r;
      trailColors[i * 3 + 1] = toolColor.g;
      trailColors[i * 3 + 2] = toolColor.b;

      // Size decreases towards the tail
      trailSizes[i] = (i / trailLength) * 15 + 2;
    }

    trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    trailGeometry.setAttribute('size', new THREE.BufferAttribute(trailSizes, 1));

    const trailMaterial = new THREE.PointsMaterial({
      size: 8,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // Glowing effect
    });

    const trail = new THREE.Points(trailGeometry, trailMaterial);
    trail.renderOrder = 998; // Behind cursor but above terrain
    trail.visible = false;
    group.add(trail);
    trailRef.current = trail;

    // Initialize trail tracking arrays
    trailPositionsRef.current = [];
    trailOpacitiesRef.current = [];

    cursorGroupRef.current = group;
    group.visible = false;
    scene.add(group);

    return () => {
      if (cursorGroupRef.current && scene) {
        // Dispose of all geometries and materials
        cursorGroupRef.current.traverse((child) => {
          if (child instanceof THREE.Line || child instanceof THREE.Mesh || child instanceof THREE.Points) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
        scene.remove(cursorGroupRef.current);
        cursorGroupRef.current = null;
      }
      trailRef.current = null;
      trailPositionsRef.current = [];
      trailOpacitiesRef.current = [];
    };
  }, [engine, activeTool]);

  // Update cursor position and shape to conform to terrain
  useEffect(() => {
    if (!cursorGroupRef.current || !engine || !canvasElement) return;

    const camera = engine.getCamera();
    if (!camera) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Set visibility based on isVisible prop
    if (!isVisible) {
      cursorGroupRef.current.visible = false;
      return;
    }

    // Check if at capacity limits
    const isFull = handMass >= handCapacity * 0.99; // 99% full
    const isEmpty = handMass <= handCapacity * 0.01; // 1% or less
    const isBlocked = (brushMode === 'pickup' && isFull) || (brushMode === 'deposit' && isEmpty);

    // Use shared raycasting utility
    const raycastResult = raycastToTerrain(engine, canvasElement, mousePosition);

    // Use last valid position if no current hit
    let centerPosition: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

    if (raycastResult) {
      centerPosition = raycastResult.point.clone();
      centerPosition.y += 0.2; // Slight offset above terrain
      normal = raycastResult.normal;
      lastValidPositionRef.current = centerPosition.clone();
    } else if (lastValidPositionRef.current) {
      centerPosition = lastValidPositionRef.current.clone();
    }

    if (centerPosition) {

      // Update cursor position
      cursorGroupRef.current.position.copy(centerPosition);

      // Update the circle to conform to terrain
      const centerDot = cursorGroupRef.current.children[0] as THREE.Mesh; // Center dot is child[0]
      const line = cursorGroupRef.current.children[1] as THREE.Line; // Line is child[1]
      const fillMesh = cursorGroupRef.current.children[2] as THREE.Mesh; // Fill is child[2]
      const blockedIndicator = cursorGroupRef.current.children[3] as THREE.Group; // Blocked indicator is child[3]

      // Show/hide blocked indicator based on capacity
      if (blockedIndicator) {
        blockedIndicator.visible = isAltPressed && isBlocked;
      }

      // Update trail effect
      if (trailRef.current) {
        const trail = trailRef.current;
        const trailLength = 20;

        // Add current position to trail history
        const currentPos = centerPosition.clone();
        currentPos.y += 0.3; // Slightly above terrain

        trailPositionsRef.current.unshift(currentPos);
        trailOpacitiesRef.current.unshift(1.0);

        // Limit trail length
        if (trailPositionsRef.current.length > trailLength) {
          trailPositionsRef.current = trailPositionsRef.current.slice(0, trailLength);
          trailOpacitiesRef.current = trailOpacitiesRef.current.slice(0, trailLength);
        }

        // Update trail geometry
        const positions = trail.geometry.attributes.position.array as Float32Array;
        const colors = trail.geometry.attributes.color.array as Float32Array;
        const sizes = trail.geometry.attributes.size.array as Float32Array;

        const toolColor = new THREE.Color(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));

        for (let i = 0; i < trailLength; i++) {
          if (i < trailPositionsRef.current.length) {
            const pos = trailPositionsRef.current[i];
            const age = i / trailLength;
            const opacity = (1 - age) * 0.8;

            positions[i * 3] = pos.x;
            positions[i * 3 + 1] = pos.y;
            positions[i * 3 + 2] = pos.z;

            // Fade color over time
            colors[i * 3] = toolColor.r * opacity;
            colors[i * 3 + 1] = toolColor.g * opacity;
            colors[i * 3 + 2] = toolColor.b * opacity;

            // Size decreases over time
            sizes[i] = (1 - age) * 12 + 2;
          } else {
            // Hide unused trail points
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -1000;
            positions[i * 3 + 2] = 0;
            colors[i * 3] = 0;
            colors[i * 3 + 1] = 0;
            colors[i * 3 + 2] = 0;
            sizes[i] = 0;
          }
        }

        trail.geometry.attributes.position.needsUpdate = true;
        trail.geometry.attributes.color.needsUpdate = true;
        trail.geometry.attributes.size.needsUpdate = true;
        trail.visible = true;
      }

      // Calculate zoom-based scaling
      const cameraDistance = camera.position.distanceTo(centerPosition);
      const zoomScale = Math.max(0.5, Math.min(2.5, 30 / cameraDistance));

      // Update center dot position
      if (centerDot) {
        centerDot.position.y = 0.05; // Slight offset above terrain
      }

      // Update fill mesh position to follow terrain
      if (fillMesh) {
        fillMesh.position.y = 0.02; // Just above terrain
      }

      if (line && line.geometry) {
        const positions = line.geometry.attributes.position;
        const segments = 64;

        // Update line thickness based on zoom
        const lineMaterial = line.material as THREE.LineBasicMaterial;
        if (lineMaterial) {
          const baseThickness = brushSize < 5 ? 5 : 3;
          lineMaterial.linewidth = Math.max(2, Math.min(8, baseThickness * zoomScale));
        }

        for (let i = 0; i <= segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          const localX = Math.cos(angle) * brushSize;
          const localZ = Math.sin(angle) * brushSize;

          // Get world position for this point
          const worldX = centerPosition.x + localX;
          const worldZ = centerPosition.z + localZ;

          // Get terrain height at this point
          const pointHeight = engine.getTerrainHeightAt(worldX, worldZ);

          if (pointHeight !== null) {
            // Set position relative to center with terrain-following height
            positions.setXYZ(
              i,
              localX,
              pointHeight - centerPosition.y + 0.1, // Offset relative to center
              localZ
            );
          } else {
            // Fallback to flat circle
            positions.setXYZ(i, localX, 0, localZ);
          }
        }

        positions.needsUpdate = true;
      }

      // Create rotation from normal
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, normal);

      // Apply a smooth rotation to prevent jarring changes
      cursorGroupRef.current.quaternion.slerp(quaternion, 0.3);

      cursorGroupRef.current.visible = true;
    } else {
      cursorGroupRef.current.visible = false;

      // Hide trail when cursor is not visible
      if (trailRef.current) {
        trailRef.current.visible = false;
        // Clear trail history
        trailPositionsRef.current = [];
        trailOpacitiesRef.current = [];
      }
    }
  }, [isVisible, mousePosition, engine, canvasElement, brushSize, handMass, handCapacity, brushMode, isAltPressed]);

  // Update cursor appearance when tool, size, or Alt key changes
  useEffect(() => {
    if (!cursorGroupRef.current) return;

    // Determine opacity based on Alt key state
    const lineOpacity = isAltPressed ? 1.0 : (activeTool === 'select' ? 0.8 : 0.6); // Saturated when Alt pressed
    const fillOpacity = isAltPressed ? 0.15 : 0.05; // More subtle fill, reduced opacity
    const lineWidth = isAltPressed ? 10 : (activeTool === 'select' ? 3 : 8); // Even thicker when Alt pressed

    // Update colors and opacity for all children
    cursorGroupRef.current.children.forEach((child, index) => {
      if (index === 0) { // Center dot
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = lineOpacity;
      } else if (index === 1) { // Line
        const material = (child as THREE.Line).material as THREE.LineBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = lineOpacity;
        material.linewidth = lineWidth;
      } else if (index === 2) { // Fill
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.color.setHex(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
        material.opacity = fillOpacity;
      }
    });

    // Update cursor size
    const centerDot = cursorGroupRef.current.children[0] as THREE.Mesh; // Center dot is child[0]
    const line = cursorGroupRef.current.children[1] as THREE.Line; // Line is child[1]
    const fillMesh = cursorGroupRef.current.children[2] as THREE.Mesh; // Fill is child[2]

    // Note: Center dot size doesn't change with brush size - it stays as a fixed reference point

    // Update outline
    if (line && line.geometry) {
      const segments = 64;
      const points: THREE.Vector3[] = [];

      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const x = Math.cos(angle) * brushSize;
        const z = Math.sin(angle) * brushSize;
        points.push(new THREE.Vector3(x, 0.05, z));
      }

      line.geometry.setFromPoints(points);
    }

    // Update fill mesh size
    if (fillMesh && fillMesh.geometry) {
      fillMesh.geometry.dispose();
      const fillGeometry = new THREE.RingGeometry(0, brushSize, 64);
      fillMesh.geometry = fillGeometry;
    }

    // Update blocked indicator size
    if (blockedIndicatorRef.current) {
      const blockedGroup = blockedIndicatorRef.current;
      const lineLength = brushSize * 0.8;

      // Update X lines
      const line1 = blockedGroup.children[0] as THREE.Line;
      const line2 = blockedGroup.children[1] as THREE.Line;
      if (line1 && line2) {
        const line1Points = [
          new THREE.Vector3(-lineLength/2, 0.1, -lineLength/2),
          new THREE.Vector3(lineLength/2, 0.1, lineLength/2)
        ];
        const line2Points = [
          new THREE.Vector3(-lineLength/2, 0.1, lineLength/2),
          new THREE.Vector3(lineLength/2, 0.1, -lineLength/2)
        ];
        line1.geometry.setFromPoints(line1Points);
        line2.geometry.setFromPoints(line2Points);
      }

      // Update circle size
      const blockedCircle = blockedGroup.children[2] as THREE.Mesh;
      if (blockedCircle && blockedCircle.geometry) {
        blockedCircle.geometry.dispose();
        const newCircleGeometry = new THREE.RingGeometry(brushSize * 0.6, brushSize * 0.65, 32);
        blockedCircle.geometry = newCircleGeometry;
      }
    }

    // Update trail colors when tool changes
    if (trailRef.current) {
      const trail = trailRef.current;
      const colors = trail.geometry.attributes.color.array as Float32Array;
      const toolColor = new THREE.Color(parseInt(TOOL_COLORS[activeTool].replace('#', '0x')));
      const trailLength = 20;

      for (let i = 0; i < trailLength; i++) {
        const age = i / trailLength;
        const opacity = (1 - age) * 0.8;

        colors[i * 3] = toolColor.r * opacity;
        colors[i * 3 + 1] = toolColor.g * opacity;
        colors[i * 3 + 2] = toolColor.b * opacity;
      }

      trail.geometry.attributes.color.needsUpdate = true;
    }
  }, [activeTool, brushSize, isAltPressed]);

  // This component doesn't render anything in React - it manages 3D objects directly
  return null;
}