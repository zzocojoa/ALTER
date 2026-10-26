import { z } from "zod";
import { preparedPageImage } from "./image.ts";
import { pageResult } from "./result.ts";

export const imageMetadata = preparedPageImage.omit({ dataUrl: true });
export type ImageMetadata = Readonly<z.infer<typeof imageMetadata>>;
export const storedExtractionPage = z.object({ id: z.string().uuid(), jobId: z.string().uuid(), selectionRevision: z.number().int().positive(), filePage: z.number().int().positive(), version: z.number().int().positive(), resultVersion: z.number().int().nonnegative(), resultId: z.string().uuid().nullable(), state: z.enum(["pending", "running", "complete", "failed", "unknown"]), printedPage: z.string().max(40).nullable(), pendingAiKey: z.string().nullable(), pendingImage: imageMetadata.nullable(), resultImage: imageMetadata.nullable(), failure: z.string().nullable(), confirmedSegmentIds: z.array(z.string()).max(1000), result: pageResult.nullable() }).strict();
export type StoredExtractionPage = Readonly<z.infer<typeof storedExtractionPage>>;
export function metadataOfImage(image: z.infer<typeof preparedPageImage>): ImageMetadata { const { dataUrl: _dataUrl, ...metadata } = image; void _dataUrl; return imageMetadata.parse(metadata); }
