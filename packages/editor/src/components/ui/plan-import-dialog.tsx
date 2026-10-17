'use client'

import { DEFAULT_WALL_HEIGHT } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { importPlanPage, planWallsFromPage } from '../../lib/plan-import/import-plan'
import { type PdfPlanPage, readPdfPlanPage } from '../../lib/plan-import/pdf-plan'
import useEditor from '../../store/use-editor'
import { Button } from './primitives/button'
import { Checkbox } from './primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'
import { Input } from './primitives/input'

type PlanImportRequest = { file: File; levelId: string }

export const usePlanImport = create<{
  request: PlanImportRequest | null
  open: (request: PlanImportRequest) => void
  close: () => void
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}))

export function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function PlanImportDialog() {
  const request = usePlanImport((state) => state.request)
  const close = usePlanImport((state) => state.close)
  return (
    <Dialog onOpenChange={(open) => !open && close()} open={request !== null}>
      {request && <PlanImportContent key={`${request.file.name}-${request.levelId}`} request={request} />}
    </Dialog>
  )
}

function PlanImportContent({ request }: { request: PlanImportRequest }) {
  const close = usePlanImport((state) => state.close)
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<PdfPlanPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scaleInput, setScaleInput] = useState('')
  const [createWalls, setCreateWalls] = useState(true)
  const [heightInput, setHeightInput] = useState(
    String(useEditor.getState().toolDefaults.wall?.height ?? DEFAULT_WALL_HEIGHT),
  )
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPage(null)
    setError(null)
    readPdfPlanPage(request.file, pageNumber)
      .then((read) => {
        if (cancelled) return
        setPage(read)
        if (read.printedScale) setScaleInput(String(read.printedScale))
      })
      .catch(() => !cancelled && setError('Could not read this PDF.'))
    return () => {
      cancelled = true
    }
  }, [request.file, pageNumber])

  const imageUrl = useMemo(() => (page ? URL.createObjectURL(page.image) : null), [page])
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    },
    [imageUrl],
  )

  const scale = Number(scaleInput)
  const validScale = Number.isFinite(scale) && scale > 0
  const walls = useMemo(
    () => (page && validScale ? planWallsFromPage(page, scale) : []),
    [page, scale, validScale],
  )
  const height = Number(heightInput)
  const validHeight = Number.isFinite(height) && height > 0.5 && height < 20

  const handleImport = async () => {
    if (!(page && validScale && (validHeight || !createWalls))) return
    setImporting(true)
    try {
      const guide = await importPlanPage({
        levelId: request.levelId,
        name: request.file.name.replace(/\.pdf$/i, ''),
        page,
        scale,
        walls: createWalls ? walls : [],
        wallHeight: height,
      })
      const editor = useEditor.getState()
      useViewer.getState().setShowGuides(true)
      editor.setSelectedReferenceId(guide.id)
      editor.setGuideLocked(guide.id, true)
      useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
      close()
    } catch {
      setError('Could not import this plan.')
      setImporting(false)
    }
  }

  const meters = page && validScale ? (page.widthMm * scale) / 1000 : null

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Import floor plan</DialogTitle>
        <DialogDescription>{request.file.name}</DialogDescription>
      </DialogHeader>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : !(page && imageUrl) ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading PDF…
        </div>
      ) : (
        <>
          <div className="relative h-[50dvh] overflow-hidden rounded-md border bg-white">
            <img alt="" className="h-full w-full object-contain" src={imageUrl} />
            {createWalls && meters && (
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full"
                viewBox={`${-meters / 2} ${(-meters * page.heightMm) / page.widthMm / 2} ${meters} ${(meters * page.heightMm) / page.widthMm}`}
              >
                {walls.map((wall) => (
                  <line
                    key={`${wall.start.join()}-${wall.end.join()}`}
                    stroke="rgb(220 38 38 / 0.65)"
                    strokeLinecap="square"
                    strokeWidth={wall.thickness}
                    x1={wall.start[0]}
                    x2={wall.end[0]}
                    y1={wall.start[1]}
                    y2={wall.end[1]}
                  />
                ))}
              </svg>
            )}
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            {page.pageCount > 1 && (
              <label className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">Page</span>
                <Input
                  className="h-8 w-20"
                  max={page.pageCount}
                  min={1}
                  onChange={(event) => setPageNumber(Number(event.target.value) || 1)}
                  type="number"
                  value={pageNumber}
                />
                <span className="text-muted-foreground">{`of ${page.pageCount}`}</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-muted-foreground">Drawing scale</span>
              <span>1 :</span>
              <Input
                aria-invalid={!validScale}
                className="h-8 w-24"
                inputMode="numeric"
                onChange={(event) => setScaleInput(event.target.value)}
                value={scaleInput}
              />
            </label>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              {page.printedScale
                ? `Scale read from the sheet. The sheet is ${meters?.toFixed(2)} m wide at this scale.`
                : 'No scale found on the sheet. Enter the scale printed on the plan.'}
            </p>
            <label className="flex items-center gap-2">
              <Checkbox checked={createWalls} onCheckedChange={setCreateWalls} />
              <span>Create walls</span>
              <span className="text-muted-foreground">{`(${walls.length} found)`}</span>
            </label>
            {createWalls && (
              <label className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-muted-foreground">Wall height</span>
                <Input
                  aria-invalid={!validHeight}
                  className="h-8 w-24"
                  inputMode="decimal"
                  onChange={(event) => setHeightInput(event.target.value.replace(',', '.'))}
                  value={heightInput}
                />
                <span>m</span>
              </label>
            )}
          </div>
        </>
      )}

      <DialogFooter>
        <Button onClick={close} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={!(page && validScale && (validHeight || !createWalls)) || importing}
          onClick={handleImport}
        >
          {importing && <Loader2 className="animate-spin" />}
          Import
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
