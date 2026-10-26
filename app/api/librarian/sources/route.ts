import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { recordId } from "@/lib/domain/contracts";
import { librarianErrorResponse, readMaterialSourceChoices } from "@/lib/librarian/server";
export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { return privateJson(await readMaterialSourceChoices(access.owner, recordId.parse(new URL(request.url).searchParams.get("materialId"))), 200); }
  catch (error: unknown) { return librarianErrorResponse(error); }
}
