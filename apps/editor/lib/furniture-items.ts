import type { AssetInput } from '@pascal-app/core'
import { useEffect, useState } from 'react'

// Poly Haven (CC0) furniture that the image build downloads into
// public/furniture/polyhaven (scripts/furniture/fetch.mjs), with a manifest of
// measured sizes. URLs are absolute on this server: a relative path resolves to
// the Pascal assets CDN, which doesn't have these models.
type FurnitureEntry = Pick<AssetInput, 'id' | 'name' | 'category' | 'tags' | 'attachTo'> & {
  dimensions: [number, number, number]
  offset: [number, number, number]
}

const BASE = '/furniture/polyhaven'

let cached: Promise<AssetInput[]> | null = null

function loadFurnitureItems(): Promise<AssetInput[]> {
  cached ??= fetch(`${BASE}/manifest.json`)
    .then((response) => (response.ok ? (response.json() as Promise<FurnitureEntry[]>) : []))
    .then((entries): AssetInput[] => {
      const origin = window.location.origin
      return entries.map((entry) => ({
        ...entry,
        id: `polyhaven-${entry.id.toLowerCase()}`,
        thumbnail: `${origin}${BASE}/${entry.id}/thumbnail.png`,
        src: `${origin}${BASE}/${entry.id}/model.glb`,
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      }))
    })
    .catch((): AssetInput[] => [])
  return cached
}

export function useFurnitureItems(): AssetInput[] {
  const [items, setItems] = useState<AssetInput[]>([])
  useEffect(() => {
    let active = true
    loadFurnitureItems().then((loaded) => {
      if (active) setItems(loaded)
    })
    return () => {
      active = false
    }
  }, [])
  return items
}
