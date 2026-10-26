import { z } from "zod";
import { googleQuotaPolicy } from "./quota.ts";
import { googlePickerEvidence } from "./picker.ts";
import { googleFailure } from "./errors.ts";

const googleApiConfiguration = z.object({ quota: googleQuotaPolicy, picker: googlePickerEvidence }).strict();
export type GoogleApiConfiguration = Readonly<z.infer<typeof googleApiConfiguration>>;
export function requireGoogleApiConfiguration(raw: string | undefined): GoogleApiConfiguration {
  if (!raw) throw googleFailure("google_configuration_invalid", "api-configuration-missing");
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error: unknown) { if (error instanceof SyntaxError) throw googleFailure("google_configuration_invalid", "api-configuration-json"); throw error; }
  const parsed = googleApiConfiguration.safeParse(value);
  if (!parsed.success) throw googleFailure("google_configuration_invalid", "api-configuration-schema");
  return parsed.data;
}

/** Sites의 변수별 크기 제한에 맞춰 명시한 네 조각을 순서대로 결합합니다. */
export function assembleGoogleApiConfiguration(manifest: string | undefined, parts: readonly (string | undefined)[]): string {
  if (!manifest) throw googleFailure("google_configuration_invalid", "api-configuration-manifest-missing");
  let value: unknown;
  try { value = JSON.parse(manifest); } catch (error: unknown) { if (error instanceof SyntaxError) throw googleFailure("google_configuration_invalid", "api-configuration-manifest-json"); throw error; }
  if (!z.object({ format: z.literal("json-chunks-v1"), parts: z.literal(4) }).strict().safeParse(value).success || parts.length !== 4) throw googleFailure("google_configuration_invalid", "api-configuration-manifest-schema");
  const checked: string[] = parts.map((part: string | undefined): string => {
    if (!part || new TextEncoder().encode(part).byteLength > 4500) throw googleFailure("google_configuration_invalid", "api-configuration-part-missing-or-large");
    return part;
  });
  return checked.join("");
}
