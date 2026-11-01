import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  function sanitize(obj: Record<string, unknown>) {
    delete obj["$schema"];
    delete obj["additionalProperties"];
    delete obj["default"];

    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object") {
              sanitize(item as Record<string, unknown>);
            }
          }
        } else {
          sanitize(val as Record<string, unknown>);
        }
      }
    }
  }

  sanitize(cloned);
  return cloned;
}

// base64 image data WITHOUT the "data:...;base64," prefix
export type GeminiImage = { mimeType: string; data: string };

export type GenerateJsonOptions = {
  model?: "FAST" | "SMART" | "FALLBACK";
  systemInstruction?: string;
  timeoutMs?: number;
  images?: GeminiImage[]; // for receipts and other vision calls
  maxOutputTokens?: number; // default 4096, stops replies being cut off mid-object
  temperature?: number; // default 0.2
};

export type GenerateJsonResult<T> =
  | { success: true; data: T; modelUsed: string }
  | { success: false; flagged: true; error: string; rawText?: string; modelUsed: string };

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;

function getModelName(slot: "FAST" | "SMART" | "FALLBACK" = "FAST"): string {
  if (slot === "SMART" || process.env.USE_SMART === "true") {
    return process.env.GEMINI_MODEL_SMART || "gemini-3.6-flash";
  }
  if (slot === "FALLBACK") {
    return process.env.GEMINI_MODEL_FALLBACK || "gemini-3.1-flash-lite";
  }
  return process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite";
}

function describeError(err: any): string {
  const base = String(err?.message || err);
  const c = err?.cause;
  const cause = c ? String(c.code || c.message || c) : "";
  const status = err?.status ? ` [status ${err.status}]` : "";
  return `${base}${cause ? ` (cause: ${cause})` : ""}${status}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(
  ai: GoogleGenAI,
  modelName: string,
  prompt: string,
  jsonSchema: Record<string, unknown>,
  timeoutMs: number,
  systemInstruction?: string,
  images?: GeminiImage[],
  maxOutputTokens: number = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature: number = DEFAULT_TEMPERATURE,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const contents =
      images && images.length > 0
        ? [
            {
              role: "user",
              parts: [
                ...images.map((i) => ({
                  inlineData: { mimeType: i.mimeType, data: i.data },
                })),
                { text: prompt },
              ],
            },
          ]
        : prompt;

    const response = await ai.models.generateContent({
      model: modelName,
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: jsonSchema as any,
        abortSignal: controller.signal,
        maxOutputTokens,
        temperature,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateJson<T>(
  schema: z.ZodType<T>,
  prompt: string,
  options: GenerateJsonOptions = {},
): Promise<GenerateJsonResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      flagged: true,
      error: "GEMINI_API_KEY is not set",
      modelUsed: "none",
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const rawJsonSchema = zodToJsonSchema(schema as any, "plexus_response");
  const responseJsonSchema = cleanJsonSchema(
    (rawJsonSchema.definitions?.plexus_response as Record<string, unknown>) || rawJsonSchema,
  );

  const initialModelSlot = options.model || (process.env.USE_SMART === "true" ? "SMART" : "FAST");
  let currentModelName = getModelName(initialModelSlot);
  const timeoutMs = options.timeoutMs || 25000;
  const images = options.images;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;

  const delays = [2000, 4000, 8000];
  let lastError: any = null;
  let rawResponseText: string | undefined;

  // Execute up to 3 tries on main model
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rawResponseText = await callGeminiOnce(
        ai,
        currentModelName,
        prompt,
        responseJsonSchema,
        timeoutMs,
        options.systemInstruction,
        images,
        maxOutputTokens,
        temperature,
      );
      break;
    } catch (err: any) {
      lastError = err;
      const status =
        err.status ||
        err.statusCode ||
        (err.message?.includes("503") ? 503 : 0) ||
        (err.message?.includes("429") ? 429 : 0);
      if (status === 503 || status === 429 || err.name === "AbortError" || attempt < 2) {
        await delay(delays[attempt] || 2000);
      } else {
        break;
      }
    }
  }

  // If 3 tries failed on main model, try GEMINI_MODEL_FALLBACK once
  if (!rawResponseText) {
    const fallbackModelName = getModelName("FALLBACK");
    if (fallbackModelName && fallbackModelName !== currentModelName) {
      currentModelName = fallbackModelName;
      try {
        rawResponseText = await callGeminiOnce(
          ai,
          currentModelName,
          prompt,
          responseJsonSchema,
          timeoutMs,
          options.systemInstruction,
          images,
          maxOutputTokens,
          temperature,
        );
      } catch (err: any) {
        lastError = err;
      }
    }
  }

  if (!rawResponseText) {
    return {
      success: false,
      flagged: true,
      error: lastError ? describeError(lastError) : "Failed to obtain Gemini response after retries",
      modelUsed: currentModelName,
    };
  }

  // Parse and validate with Zod
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawResponseText);
  } catch (parseErr: any) {
    // Retry once with error text
    const retryPrompt = `${prompt}\n\nPREVIOUS ATTEMPT OUTPUT WAS NOT VALID JSON: ${parseErr.message}. Output ONLY valid JSON adhering to the schema.`;
    try {
      rawResponseText = await callGeminiOnce(
        ai,
        currentModelName,
        retryPrompt,
        responseJsonSchema,
        timeoutMs,
        options.systemInstruction,
        images,
        maxOutputTokens,
        temperature,
      );
      parsedJson = JSON.parse(rawResponseText);
    } catch (retryErr: any) {
      return {
        success: false,
        flagged: true,
        error: `JSON parse failed after retry: ${retryErr.message}`,
        rawText: rawResponseText,
        modelUsed: currentModelName,
      };
    }
  }

  const validation = schema.safeParse(parsedJson);
  if (validation.success) {
    return {
      success: true,
      data: validation.data,
      modelUsed: currentModelName,
    };
  }

  // Schema validation failed: retry once with error message
  const validationErrorText = JSON.stringify(validation.error.format());
  const retryValidationPrompt = `${prompt}\n\nPREVIOUS JSON DID NOT MATCH SCHEMA: ${validationErrorText}\nPREVIOUS JSON: ${JSON.stringify(
    parsedJson,
  )}\nPlease fix and return the corrected JSON object matching the schema.`;

  try {
    rawResponseText = await callGeminiOnce(
      ai,
      currentModelName,
      retryValidationPrompt,
      responseJsonSchema,
      timeoutMs,
      options.systemInstruction,
      images,
      maxOutputTokens,
      temperature,
    );
    const retryParsed = JSON.parse(rawResponseText);
    const retryValidation = schema.safeParse(retryParsed);
    if (retryValidation.success) {
      return {
        success: true,
        data: retryValidation.data,
        modelUsed: currentModelName,
      };
    } else {
      return {
        success: false,
        flagged: true,
        error: `Schema validation failed after retry: ${JSON.stringify(retryValidation.error.format())}`,
        rawText: rawResponseText,
        modelUsed: currentModelName,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      flagged: true,
      error: `Model retry failed: ${err.message}`,
      rawText: rawResponseText,
      modelUsed: currentModelName,
    };
  }
}