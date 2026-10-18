import {
  type MaterialCatalogItem,
  MaterialMapPropertiesSchema,
  registerLibraryMaterials,
} from '@pascal-app/core'
import manifest from './photo-materials.json'

// Photo textures (CC0, ambientCG) that the image build downloads into
// public/material/photo (scripts/fetch-photo-materials.sh). Their URLs are
// absolute on this server: a relative /material path resolves to the Pascal
// assets CDN, which doesn't have them.
type PhotoMaterial = {
  asset: string
  label: string
  category: MaterialCatalogItem['category']
  surfaces: NonNullable<MaterialCatalogItem['surfaces']>
  size: [number, number]
  roughness: number
}

export function photoMaterialSlug(asset: string) {
  return asset.toLowerCase()
}

export function photoMaterialItems(origin: string): MaterialCatalogItem[] {
  return (manifest.materials as PhotoMaterial[]).map((material) => {
    const base = `${origin}/material/photo/${photoMaterialSlug(material.asset)}`
    return {
      id: `photo-${photoMaterialSlug(material.asset)}`,
      label: material.label,
      category: material.category,
      surfaces: material.surfaces,
      description: `Fototextur ${material.asset} (ambientCG, CC0)`,
      previewThumbnailUrl: `${base}/thumb.jpg`,
      preset: {
        maps: {
          albedoMap: `${base}/color.jpg`,
          normalMap: `${base}/normal.jpg`,
          roughnessMap: `${base}/roughness.jpg`,
        },
        // Repeat is tiles per metre (world-scale UVs), so one texture covers its photographed size.
        mapProperties: MaterialMapPropertiesSchema.parse({
          roughness: material.roughness,
          repeatX: 1 / material.size[0],
          repeatY: 1 / material.size[1],
          displacementScale: 0,
        }),
      },
    }
  })
}

export function registerPhotoMaterials() {
  if (typeof window === 'undefined') return
  registerLibraryMaterials(photoMaterialItems(window.location.origin))
}
