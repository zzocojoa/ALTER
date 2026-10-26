import { sql } from "drizzle-orm";
import { check,foreignKey,index,integer,primaryKey,sqliteTable,text,unique } from "drizzle-orm/sqlite-core";
import { googleConnections } from "./learning-schema.ts";
import { materialTransfers } from "./material-schema.ts";

/** 읽은 사본의 해시와 원본 버전을 보존하며 실패한 읽기에 출처 확정 기록을 만들지 않습니다. */
export const googleReferenceReads=sqliteTable("google_reference_reads",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),connectionId:text("connection_id").notNull(),generation:integer("generation").notNull(),fileId:text("file_id").notNull(),state:text("state").notNull(),proof:text("proof"),createdAt:integer("created_at").notNull(),finishedAt:integer("finished_at"),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.connectionId],foreignColumns:[googleConnections.ownerId,googleConnections.id]}).onDelete("restrict"),index("google_reference_owner_file").on(t.ownerId,t.fileId),check("google_reference_state",sql.raw("generation>=1 AND state IN ('reading','verified','failed') AND ((state='reading' AND proof IS NULL AND finished_at IS NULL) OR (state='failed' AND proof IS NULL AND finished_at>=created_at) OR (state='verified' AND json_valid(proof) AND finished_at>=created_at))"))]);

/** 등록 시점의 읽기 증거와 예약된 자료를 한 트랜잭션으로 연결합니다. */
export const googleMaterialSources=sqliteTable("google_material_sources",{
  ownerId:text("owner_id").notNull(),readId:text("read_id").notNull(),transferId:text("transfer_id").notNull(),materialId:text("material_id").notNull(),linkedAt:integer("linked_at").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.readId]}),unique("google_material_source_once").on(t.ownerId,t.materialId),foreignKey({columns:[t.ownerId,t.readId],foreignColumns:[googleReferenceReads.ownerId,googleReferenceReads.id]}).onDelete("restrict"),foreignKey({columns:[t.ownerId,t.transferId,t.materialId],foreignColumns:[materialTransfers.ownerId,materialTransfers.id,materialTransfers.materialId]}).onDelete("restrict"),check("google_material_source_time",sql.raw("linked_at>=0"))]);
