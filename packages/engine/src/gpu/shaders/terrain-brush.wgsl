struct BrushOp {
    kind: u32,     // 0: raise, 1: lower, 2: smooth
    position: vec2<f32>,
    radius: f32,
    strength: f32,
}

struct BrushBuffer {
    count: u32,
    ops: array<BrushOp, 16>,
}

@group(0) @binding(0) var heightmap: texture_storage_2d<r32float, read_write>;
@group(0) @binding(1) var<storage, read> brushes: BrushBuffer;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(heightmap);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let pos = vec2<i32>(id.xy);
    let uv = vec2<f32>(id.xy) / vec2<f32>(dims);
    var height = textureLoad(heightmap, pos).x;

    // Apply each brush operation
    for (var i = 0u; i < brushes.count && i < 16u; i++) {
        let op = brushes.ops[i];
        let dist = length(uv - op.position);

        if (dist <= op.radius) {
            let falloff = smoothstep(op.radius, 0.0, dist);
            let delta = op.strength * falloff;

            if (op.kind == 0u) {
                // Raise
                height += delta;
            } else if (op.kind == 1u) {
                // Lower
                height -= delta;
            } else if (op.kind == 2u) {
                // Smooth - blend toward average of neighbors
                var sum = 0.0;
                var count = 0.0;
                for (var dy = -1; dy <= 1; dy++) {
                    for (var dx = -1; dx <= 1; dx++) {
                        let npos = pos + vec2<i32>(dx, dy);
                        if (npos.x >= 0 && npos.x < i32(dims.x) &&
                            npos.y >= 0 && npos.y < i32(dims.y)) {
                            sum += textureLoad(heightmap, npos).x;
                            count += 1.0;
                        }
                    }
                }
                let avg = sum / count;
                height = mix(height, avg, delta * 0.5);
            }
        }
    }

    // Clamp height to reasonable bounds
    height = clamp(height, 0.0, 100.0);

    textureStore(heightmap, pos, vec4<f32>(height, 0.0, 0.0, 0.0));
}