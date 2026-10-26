import { getStudyScope } from "../../db/repositories/study-scopes";
import { librarianContext } from "../../lib/librarian/ai";
import { librarianOutputFixture } from "./librarian-output";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import type { RuntimeFixture } from "./learning-ai-runtime";
import type { SiteIdentity } from "../../lib/domain/contracts";
export function librarianRuntimeFixture(db:D1Database,owner:SiteIdentity,id:string):RuntimeFixture {return learningRuntimeFixture(db,owner,async ()=>librarianContext(await getStudyScope(db,owner,id)),async ()=>librarianOutputFixture(await getStudyScope(db,owner,id)));}
