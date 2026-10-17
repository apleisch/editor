// pdfjs-dist ships no types for its worker bundle; it is only loaded to register the in-thread worker.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
