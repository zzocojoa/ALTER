import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { describe, expect, it, vi } from "vitest";
import { authorizeAiImages } from "../../lib/ai/server";
import { prepareAiRequest } from "../../lib/ai/request-bound";
import type { InputImage, PreparedAiRequest } from "../../lib/ai/request-bound";
import { hashFile } from "../../lib/learning-upload";
import { recordId } from "../../lib/domain/contracts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts";
import { createCourse } from "../../db/repositories/courses";
import { createMaterial, reserveUpload, recordUploadObservation, createPage, createSourceReference, uploadObjectKey } from "../../db/repositories/materials";
import type { UploadInput } from "../../db/repositories/materials";

vi.mock("cloudflare:workers", (): Readonly<{ env: Readonly<{ ALTER_OWNER_USER_ID?: string }> }> => ({ env: {} }));
vi.mock("../../app/chatgpt-auth", (): Readonly<{ getChatGPTUser: () => Promise<null> }> => ({ getChatGPTUser: async (): Promise<null> => null }));

type SourceFixture = Readonly<{ db: D1Database; owner: SiteIdentity; upload: UploadInput; image: InputImage; prepared: PreparedAiRequest }>;

function command(owner: SiteIdentity, version: number): Command {
  return { owner, requestKey: crypto.randomUUID(), expectedVersion: version };
}

async function prepareImage(image: InputImage): Promise<PreparedAiRequest> {
  return prepareAiRequest({ instructions: "검증된 자료만 확인합니다.", messages: [{ role: "user", content: [image] }], maximumOutputTokens: 64, reasoningEffort: "none" });
}

/** 승인 함수를 대체하지 않고 실제 D1 외래 키와 저장소 함수를 사용합니다. */
async function withVerifiedSource(assertion: (fixture: SourceFixture) => Promise<void>): Promise<void> {
  const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('source-check')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
  try {
    const db: D1Database = await runtime.getD1Database("DB") as unknown as D1Database;
    const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    // 테스트마다 빈 D1을 유지하며 마이그레이션별 왕복 호출만 합칩니다.
    for (const entry of journal.entries) {
      const statements: D1PreparedStatement[] = (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((sql: string): string => sql.trim()).filter(Boolean).map((sql: string): D1PreparedStatement => db.prepare(sql));
      await db.batch(statements);
    }
    const owner: SiteIdentity = { realm: "sites", userId: "image-source-owner" };
    const courseId: UploadInput["id"] = recordId.parse(crypto.randomUUID());
    const materialId: UploadInput["id"] = recordId.parse(crypto.randomUUID());
    const sourceId: UploadInput["id"] = recordId.parse(crypto.randomUUID());
    const pageId: UploadInput["id"] = recordId.parse(crypto.randomUUID());
    const png: Buffer = await readFile("tests/fixtures/pngsuite/basn6a08.png");
    const hash: string = await hashFile(new Uint8Array(png).buffer);
    const upload: UploadInput = { id: recordId.parse(crypto.randomUUID()), materialId, uploadId: recordId.parse(crypto.randomUUID()), expectedHash: hash, bytes: png.byteLength, recoveryAt: Date.now() };
    await createCourse(db, command(owner, 1), { id: courseId, title: "이미지 과정" });
    await createMaterial(db, command(owner, 1), { id: materialId, courseId, title: "검증 이미지", origin: "upload", originalId: null, modifiedAt: null });
    await reserveUpload(db, command(owner, 1), upload);
    await recordUploadObservation(db, command(owner, 1), upload, { objectKey: uploadObjectKey(upload), uploadId: upload.uploadId, hash, bytes: png.byteLength });
    await createPage(db, command(owner, 1), { id: pageId, materialId, uploadId: upload.id, filePage: 1, printedPage: null, content: "근거" });
    await createSourceReference(db, command(owner, 1), { id: sourceId, pageId, materialId, uploadId: upload.id, filePage: 1, printedPage: null, spanStart: 0, spanEnd: 2, evidence: "근거" });
    const image: InputImage = { type: "input_image", sourceRefId: sourceId, dataUrl: `data:image/png;base64,${png.toString("base64")}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.byteLength, detail: "low" };
    await assertion({ db, owner, upload, image, prepared: await prepareImage(image) });
  } finally { await runtime.dispose(); }
}

describe("실제 D1의 이미지 출처 승인", (): void => {
  it("레코드 ID와 전송 ID가 달라도 검증된 소유자 원본을 허용한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, upload, prepared }): Promise<void> => {
      expect(upload.id).not.toBe(upload.uploadId);
      await expect(authorizeAiImages(db, owner, prepared)).resolves.toBeUndefined();
    });
  });
  it("다른 소유자의 출처를 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, prepared }): Promise<void> => {
      await expect(authorizeAiImages(db, { realm: "sites", userId: "other-owner" }, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
  it("존재하지 않는 출처를 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, image }): Promise<void> => {
      const prepared: PreparedAiRequest = await prepareImage({ ...image, sourceRefId: recordId.parse(crypto.randomUUID()) });
      await expect(authorizeAiImages(db, owner, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
  it("검증 후 원본이 사라진 출처를 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, upload, prepared }): Promise<void> => {
      await recordUploadObservation(db, command(owner, 2), upload, null);
      await expect(authorizeAiImages(db, owner, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
  it("원본 불일치로 격리된 업로드를 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, upload, prepared }): Promise<void> => {
      await recordUploadObservation(db, command(owner, 2), upload, { objectKey: uploadObjectKey(upload), uploadId: upload.uploadId, hash: "0".repeat(64), bytes: upload.bytes });
      await expect(authorizeAiImages(db, owner, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
  it("길이가 같은 변조 바이트를 해시로 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, image }): Promise<void> => {
      const original: Buffer = Buffer.from(image.dataUrl.split(",")[1], "base64");
      const altered: Buffer = Buffer.from(original.map((value: number, index: number): number => index === 0 ? value ^ 1 : value));
      const prepared: PreparedAiRequest = await prepareImage({ ...image, dataUrl: `data:image/png;base64,${altered.toString("base64")}` });
      await expect(authorizeAiImages(db, owner, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
  it("검증 원본과 다른 길이의 바이트를 거부한다", async (): Promise<void> => {
    await withVerifiedSource(async ({ db, owner, image }): Promise<void> => {
      const bytes: Buffer = Buffer.concat([Buffer.from(image.dataUrl.split(",")[1], "base64"), Buffer.from([0])]);
      const prepared: PreparedAiRequest = await prepareImage({ ...image, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, bytes: bytes.byteLength });
      await expect(authorizeAiImages(db, owner, prepared)).rejects.toMatchObject({ code: "ai_source_denied", status: 403 });
    });
  });
});
