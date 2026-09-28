import { NextResponse } from "next/server";
import { writeCommand, getState, apiError } from "@/lib/api";
export const POST = (r: Request) => writeCommand(r, ["movement"]);
export async function GET() {
  try {
    return NextResponse.json((await getState()).movements);
  } catch (e) {
    return apiError(e);
  }
}
