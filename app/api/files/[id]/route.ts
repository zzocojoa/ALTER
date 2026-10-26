import { readPrivateObject } from "@/lib/r2-access";
import { env } from "cloudflare:workers";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { privateFileKey } from "@/lib/private-file";
import { requireStorageBindings } from "@/lib/storage-bindings";

type FileContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function GET(_request: Request, context: FileContext): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection) return rejection;
  const { id } = await context.params;
  let key: string;
  try { key = privateFileKey(id); } catch (error) {
    if (error instanceof TypeError) return privateJson({ error: "invalid_file_id" }, 400);
    throw error;
  }
  const { BUCKET } = requireStorageBindings(env);
  const object: R2ObjectBody | null = await readPrivateObject(BUCKET, key);
  if (!object) return privateJson({ error: "file_not_found" }, 404);
  return new Response(object.body, { headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${id}.bin"`, "X-Content-Type-Options": "nosniff" } });
}

/** 용량 원장 밖의 이전 쓰기·삭제 경로는 종료하고 기존 객체 읽기만 보존합니다. */
async function retired(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  return privateJson({ error: "legacy_file_mutation_retired", replacement: "/learn/materials" }, 410);
}
export async function PUT(request: Request, _context: FileContext): Promise<Response> { void _context; return retired(request); }
export async function DELETE(request: Request, _context: FileContext): Promise<Response> { void _context; return retired(request); }
