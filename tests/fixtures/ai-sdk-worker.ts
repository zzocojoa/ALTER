import { runSdkProbe } from "./ai-sdk-probe";

const worker = { async fetch(): Promise<Response> { return Response.json(await runSdkProbe()); } };
export default worker;
