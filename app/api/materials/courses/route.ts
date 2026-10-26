import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { createCourse } from "@/db/repositories/courses";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readMaterialJson } from "@/lib/materials/request";

/** 자료를 묶는 과정 이름만 만들며 학습 계획·진단을 생성하지 않습니다. */
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  try {
    const input = z.object({ title: z.string().trim().min(1).max(300) }).strict().parse(await readMaterialJson(request));
    const requestKey: string = materialRequestKey(request.headers);
    const { DB } = requireStorageBindings(env);
    const id = recordId.parse(requestKey);
    await createCourse(DB, { owner: access.owner, requestKey, expectedVersion: 1 }, { id, title: input.title });
    return privateJson({ id, title: input.title }, 201);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
