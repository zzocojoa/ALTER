import { env } from "cloudflare:workers";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings, googleErrorResponse, googleExecutionRuntime } from "@/lib/google/server";
import { googlePickerSelection } from "@/lib/google/picker";
import { executeGoogleRest } from "@/lib/google/execute";
import { verifyGoogleFile } from "@/lib/google/resources";
import { consumeGooglePickerLease, registerGoogleSelectedFile } from "@/db/repositories/google-resources";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const selection = googlePickerSelection.parse(await readBoundedJson(request, 4096)); const settings = googleApiServerSettings(access.owner);
    await consumeGooglePickerLease(env.DB, access.owner, selection, Date.now());
    const result = await executeGoogleRest(env.DB, access.owner, settings.execution, { method: "drive.files.get", fileId: selection.fileId }, { id: crypto.randomUUID(), role: "selection-candidate", storageUpperBytes: 0, selection,context:null }, googleExecutionRuntime());
    const file = verifyGoogleFile(result.data, selection.fileId, selection.role, Date.now());
    await registerGoogleSelectedFile(env.DB, access.owner, selection, file, Date.now());
    return privateJson({ name: file.name, role: file.role }, 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
