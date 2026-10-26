import { ownerRejection, privateJson } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection) return rejection;
  return privateJson({ authenticated: true, role: "owner" }, 200);
}
