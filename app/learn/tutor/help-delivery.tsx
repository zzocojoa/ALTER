"use client";
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { librarianJson } from "../library/client-api";

const deliveryReply = z.object({ acknowledged: z.literal(true) }).strict();
/** 이미 확인한 수신 기록은 재전송하지 않으며 수신 실패가 도움 사용을 취소하지 않습니다. */
export function HelpDelivery({ sessionId, helpId, deliveredAt }: Readonly<{ sessionId: string; helpId: string; deliveredAt: number | null }>): ReactElement {
  const [state, setState] = useState<"pending" | "confirmed" | "failed">(deliveredAt === null ? "pending" : "confirmed");
  const [error, setError] = useState<string>("");
  const send = useCallback(async (): Promise<void> => {
    deliveryReply.parse(await librarianJson("/api/tutor/delivery", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": helpId }, body: JSON.stringify({ id: sessionId, helpId }) }));
  }, [sessionId, helpId]);
  const confirmed = useCallback((): void => setState("confirmed"), []);
  const failed = useCallback((cause: unknown): void => { if (!(cause instanceof Error)) throw cause; setError(cause.message); setState("failed"); }, []);
  useEffect(() => {
    if (deliveredAt !== null) return;
    let active: boolean = true;
    void send().then((): void => { if (active) confirmed(); }, (cause: unknown): void => { if (active) failed(cause); });
    return (): void => { active = false; };
  }, [send, confirmed, failed, deliveredAt]);
  return <p role="status">{state === "confirmed" ? "도움 화면 수신 확인됨" : state === "pending" ? "도움 사용은 저장되었고 화면 수신을 확인하고 있어요." : <>도움 사용은 저장되었지만 화면 수신 기록을 확인하지 못했어요. {error}<button onClick={(): void => { setState("pending"); setError(""); void send().then(confirmed, failed); }}>수신 기록 다시 확인</button></>}</p>;
}
