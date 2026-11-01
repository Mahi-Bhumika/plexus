import { NextResponse } from "next/server";
import { activityEventSchema, emitEvent } from "@/lib/events";

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = activityEventSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid activity event payload", details: parsed.error.format() },
        { status: 400 },
      );
    }

    const emitted = emitEvent(parsed.data);
    return NextResponse.json(emitted, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to emit event" },
      { status: 500 },
    );
  }
}
