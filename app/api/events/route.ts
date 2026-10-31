import { NextResponse } from "next/server";
import { listEvents } from "@/lib/events";

export async function GET() {
  try {
    const events = listEvents(50);
    return NextResponse.json(events);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load events" }, { status: 500 });
  }
}
