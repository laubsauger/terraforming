awesome—here’s a concrete way to *fake* convincing water/lava that streams → rivers → lakes → ocean, all GPU-centric and performant.

# Flowing Liquids: A Hybrid Visual–Physics Stack

Think of it as three layers that feed each other but can scale independently:

1. **Field Core (low-res GPU fields) — cheap physics-ish**

* **What:** 2D grids (height H, flow F= (u,v), accumulation A, basin ID B).
* **How:** 1–3 tiny compute passes per tick at **quarter or eighth** scene resolution.

  * **Slope → Velocity:** `v = normalize(∇H) * g * dt`, damped by roughness; optionally add inertia: `v = lerp(v_prev, v_new, α)`.
  * **Flux/Continuity (lite):** move a scalar **water depth D** along `v` (semi-Lagrangian or donor-cell). If you don’t want depth, keep just **A = A + divergence of inflow** (flow accumulation).
  * **Flow Accumulation:** classic terrain trick: push “rain” downhill; accumulate counts → gives you **tiny streams merging into rivers**. Add **hysteresis** so channels persist briefly when inflow drops.
  * **Pooling (lakes):** detect **local depressions** cheaply:

    * If `div(v) > τ_div` and speed < τ\_speed, mark **pool mask P**.
    * Optional single-step **priority-flood fill** *approximation*: blur H, compare to H to flag basins (no full solver).
  * **Ocean:** mark cells at/near boundary with height ≤ sea level; flood-fill ocean flag once at load, then keep a soft band via distance transform.

**Outputs (all GPU textures):**
`H` (height), `F` (velocity), `A` (flow accumulation), `P` (pool mask), `D` (optional water depth), `T` (lava temp), `L` (lava depth), `C` (lava crust).

2. **Shading Illusion — make it *feel* liquid**

* **Terrain Wetness & Channels:** use **A** (and **D** if you keep it) to darken albedo, add gloss, and carve a **micro normal** groove (parallax/normal detail) along channels.
* **Screen-Space Flow UVs:** in the water/lava materials, **advect normal/albedo UVs** by **F** so the texture “slides” downhill even if geometry is static.

  * Prevent “texture drift pop” with **jam-resistant UVs:** two UV sets advected with different offsets, cross-faded over time (a.k.a. “flowmap ping-pong”).
* **Joining Streams:** generate a **river mask R = smoothstep(k1, k2, A\_blurred)**; blur A slightly → thin lines merge into wider ribbons naturally.
* **Foam/Streaks:** spawn **view-facing quads/decals** where:

  * `curl(F)` is high (shear), **or** `|F|` drops sharply (confluences), **or** **P** toggles (edge of pools). Use a **blue-noise** spawn texture to keep it organic.
* **Refraction & Fresnel (cheap):** sample scene color w/ perturbed UV for refraction; simple Fresnel for rim lighting; SSR is optional later.
* **Lava Style:** same **F**, but multiply down by **viscosity µ(T)**; emissive = `blackbody(T)`; **C (crust)** masks shiny molten core vs matte crust. Add slow **crackle masks** that expand along F and cool into C.

3. **Sparse Particles (optional but tasty)**

* GPU-instanced sprites (thousands) emitted from **R** ridges and steep slopes.
* Their lifetime/drag depends on **|F|**; when speed < threshold, they “die” → feels like pooling without sim cost.

---

## Minimal Pass Graph (per frame)

1. **Slope & Velocity (compute):** read H → write F
2. **Accumulation (compute):** A ← A \* decay + route along F (+ rain/source)
3. **Pool Detect (compute):** P from div(F) & speed (optional smoothed height compare)
4. **(Optional) Water/Lava Depth (compute):** advect D, L; T cools toward ambient; crust C forms when T\<Tₜh
5. **Terrain Render:** triplanar; wetness & micro channels from A, P
6. **Water Render:** mesh surface from H (+ D if you keep it); UVs advected by F; foam decals from features
7. **Lava Render:** same as water but with emissive + crust masking

All buffers are **ping-ponged**; no CPU readbacks.

---

## Key Shader Tricks (WGSL-ish sketches)

### A) Advect a flow UV (water/lava normal map)

```wgsl
// fs inputs
@group(0) @binding(0) var flowTex : texture_2d<f16>;   // F = (u,v) in tex space
@group(0) @binding(1) var sampLin : sampler;
@group(0) @binding(2) var normalTex : texture_2d<f32>;

struct Vary { @location(0) uv: vec2<f32>; };

@fragment
fn fs_main(v: Vary) -> @location(0) vec4<f32> {
  let flow   = textureSample(flowTex, sampLin, v.uv).xy * 2.0 - 1.0; // [-1,1]
  // Flow speed normalization & scale
  let flowUV = v.uv + flow * FLOW_UV_SCALE * timeDelta; // timeDelta from uniform
  // Two-phase crossfade to reduce stretching
  let n0 = textureSample(normalTex, sampLin, flowUV + phaseOffset0).xyz;
  let n1 = textureSample(normalTex, sampLin, flowUV + phaseOffset1).xyz;
  let k  = 0.5 + 0.5 * sin(time * PHASE_SPEED);
  let n  = normalize(mix(n0, n1, k) * 2.0 - 1.0);
  // Use n for lighting; output packed normal or shaded color...
  return vec4(n * 0.5 + 0.5, 1.0);
}
```

### B) River width from accumulation (streams → rivers)

```wgsl
let a = textureSample(accumTex, sampLin, v.uv).r;           // 0..1
let r = smoothstep(A_MIN, A_MAX, blur(a, v.uv));            // widen via blurred A
let glossBoost = mix(0.0, MAX_GLOSS, r);
let tint       = mix(baseColor, riverColor, r);
```

### C) Pooling mask from divergence & speed

```wgsl
let f = textureSample(flowTex, sampLin, v.uv).xy;
let div = divergence(f, v.uv);       // finite difference
let s   = length(f);
let pool = step(DIV_THR, div) * step(s, SPEED_THR);
```

### D) Lava viscosity & emissive

```wgsl
let temp = textureSample(tempTex, sampLin, v.uv).r;
let mu   = clamp(1.0 - (temp - T_min) / (T_max - T_min), 0.1, 1.0); // thicker when cool
let flowVisc = flow / (1.0 + mu * VISC_GAIN);
let emissive = blackbody(temp);                 // small LUT
let crust    = step(temp, T_crust);
```

---

## How small streams merge naturally

* **Flow accumulation A** blurs slightly each frame → adjacent tiny lines fuse.
* **Threshold with hysteresis** (`open at A>hi`, `close at A<lo`) keeps channels “on” as neighbors join.
* **Slope bias:** multiply A by `pow(max(dot(-∇H, gravityN), 0), γ)` to favor downhill and stop sideways creep.

---

## Performance Notes

* Run all field passes at **¼ or ⅛ res** of screen. Upsample with **edge-aware** filter (use ∇H) for crisp channels.
* Pack fields in **RG16F / RGBA16F** where possible; reuse bind groups; no per-frame resource re-creation.
* Show **GPU timestamps** per pass in the HUD from day one.

---

## Tuning Dials (design ↔ tech)

* **A\_MIN/A\_MAX:** when streams appear; controls “threshold to become a river”.
* **Blur radius on A:** higher → quicker merging; lower → more fingering.
* **FLOW\_UV\_SCALE:** apparent surface speed independent of sim tick.
* **Viscosity curve for lava:** steeper → chunkier, crust sooner.
* **Hysteresis gap:** stabilizes channel on/off flicker.

---

## Implementation Order (fastest path)

1. Add **Slope → F** pass + **A** accumulation (no water depth yet).
2. Hook **R from A** into terrain wetness + micro normal channels.
3. Implement **advected UV shader** for water sheet.
4. Add **foam decals** from `curl(F)` & speed-drop.
5. Add **lava**: reuse F with viscosity & emissive/crust masks.
6. (Optional) introduce **D** (water depth) for nicer refraction and shorelines.

If you want, I can drop a code scaffold (WGSL stubs + TS wrappers) for these exact passes and materials so you can plug it straight into the engine package.
