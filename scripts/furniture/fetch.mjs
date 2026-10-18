// Downloads the Poly Haven (CC0) models listed in apps/editor/lib/furniture.json,
// packs each 1k glTF into a single GLB and writes, under
// apps/editor/public/furniture/polyhaven/: <id>/model.glb, <id>/thumbnail.png and a
// manifest.json with each model's measured dimensions and the offset that
// centres it on its footprint with its base at y = 0 (the catalog convention).
// Run before the image build: `npm install --prefix scripts/furniture && node scripts/furniture/fetch.mjs`.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.join(root, 'apps/editor/public/furniture/polyhaven')
const { items } = JSON.parse(await readFile(path.join(root, 'apps/editor/lib/furniture.json'), 'utf8'))
const round = (value) => Math.round(value * 1000) / 1000

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url)
    if (response.ok) return new Uint8Array(await response.arrayBuffer())
    if (attempt === 4) throw new Error(`${url} → ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const manifest = []
for (const item of items) {
  const files = JSON.parse(new TextDecoder().decode(await download(`https://api.polyhaven.com/files/${item.id}`)))
  const gltf = files.gltf?.['1k']?.gltf
  if (!gltf) throw new Error(`${item.id}: no 1k glTF`)

  const resources = {}
  for (const [relative, file] of Object.entries(gltf.include ?? {})) {
    resources[relative] = await download(file.url)
  }
  const json = JSON.parse(new TextDecoder().decode(await download(gltf.url)))
  const document = await io.readJSON({ json, resources })
  const box = getBounds(document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0])

  const dir = path.join(out, item.id)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'model.glb'), await io.writeBinary(document))
  await writeFile(
    path.join(dir, 'thumbnail.png'),
    await download(`https://cdn.polyhaven.com/asset_img/thumbs/${item.id}.png?width=256&height=256`),
  )

  const [minX, minY, minZ] = box.min
  const [maxX, maxY, maxZ] = box.max
  manifest.push({
    ...item,
    dimensions: [maxX - minX, maxY - minY, maxZ - minZ].map(round),
    offset: [-(minX + maxX) / 2, -minY, -(minZ + maxZ) / 2].map(round),
  })
  console.log(`${item.id}: ${manifest.at(-1).dimensions.join(' × ')} m`)
}
await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
