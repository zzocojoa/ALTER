export type PdfNativeProof = Readonly<{ pages: number; objects: number; streams: number; processedStreamBytes: number; rangeReads: number; rangeBytes: number; encodedImageStreams: number }>;
export type PdfModule = Readonly<{ HEAPU8: Uint8Array; ccall: (name: "alter_pdf_validate", result: "number", argumentsTypes: readonly ["number"], argumentsValues: readonly [number], options: Readonly<{ async: true }>) => Promise<number> }>;
type PdfModuleOptions = Readonly<{
  instantiateWasm: (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) => WebAssembly.Exports;
  readRange: (offset: number, length: number) => Promise<Uint8Array>;
  rangeFailure: (error: unknown) => void;
  complete: (proof: PdfNativeProof) => void;
  failure: (message: string) => void;
}>;
export default function createPdfModule(options: PdfModuleOptions): Promise<PdfModule>;
