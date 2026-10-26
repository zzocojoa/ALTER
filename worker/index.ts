import handler from "vinext/server/fetch-handler";
import { requireStorageBindings } from "../lib/storage-bindings";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>): Promise<Response> {
    requireStorageBindings(env);
    const incoming: Request = import.meta.env.DEV && !__ALTER_LOCAL_IDENTITY__
      ? new Request(request, { headers: [...request.headers].filter(([name]) => !name.startsWith("oai-authenticated-user-")) })
      : request;
    if (env.ALTER_LOCAL_MOCK_AUTH && env.ALTER_LOCAL_MOCK_AUTH !== "0") return Response.json({ error: "runtime_mock_auth_forbidden" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    let binding = ctx.props?.CONNECTORS;
    // 로컬 미리보기의 요청 범위 연결은 운영 빌드에 포함하지 않습니다.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response: Response = await runWithConnectorBinding(binding, () => handler.fetch(incoming, env, ctx));
    const secured: Response = new Response(response.body, response);
    secured.headers.set("Cache-Control", response.headers.get("Cache-Control")?.includes("no-transform") ? "private, no-store, no-transform" : "private, no-store");
    secured.headers.set("X-Content-Type-Options", "nosniff");
    return secured;
  },
};

export default worker;
