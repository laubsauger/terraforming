# Heightmap Presets

This folder contains the preset configurations for the terrain generator.

## Files

- `presets.json` - Configuration file containing all preset definitions with their parameters
- Generated PNG files - Thumbnails are generated dynamically by the NoiseTextureGenerator component

## Adding New Presets

To add a new preset, edit the `presets.json` file and add a new entry with:

```json
{
  "id": "unique-id",
  "name": "Display Name",
  "description": "Brief description",
  "thumbnail": "/heightmap-presets/unique-id.png",
  "isDefault": false,
  "params": {
    // All noise parameters...
  }
}
```

## Preset Parameters

- `islandRadius` - Controls the size of the island (0.3-1.2)
- `islandFalloff` - Controls edge sharpness (0.2-2.0)
- `islandNoise` - Adds variation to island shape (0-1)
- `baseScale` - Frequency of base terrain (0.5-8)
- `baseOctaves` - Layers of base noise (1-8)
- `baseAmplitude` - Height of base terrain (0.1-1)
- `mountainThreshold` - When mountains appear (0.2-0.8)
- `mountainScale` - Frequency of mountains (1-12)
- `mountainOctaves` - Layers of mountain noise (1-6)
- `mountainAmplitude` - Height of mountains (0.2-2)
- `ridgeStrength` - Sharpness of ridges (0-1)
- `detailScale` - Frequency of detail (2-20)
- `detailOctaves` - Layers of detail (1-4)
- `detailAmplitude` - Amount of detail (0-0.5)
- `waterLevel` - Sea level height (0.1-0.3)
- `smoothingPasses` - Blur iterations (0-5)
- `smoothingStrength` - Blur amount (0-0.8)

## Current Presets

1. **Tropical Island** (default) - Classic island with beaches and mountains
2. **Volcanic Island** - Steep volcanic peak with rugged terrain
3. **Atoll Ring** - Ring-shaped atoll with central lagoon
4. **Archipelago** - Multiple small islands
5. **Plateau Island** - Flat-topped island with cliffs
6. **Gentle Hills** - Smooth rolling hills