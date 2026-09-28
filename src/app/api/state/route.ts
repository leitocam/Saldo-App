import { NextResponse } from "next/server";
import { getState, apiError } from "@/lib/api";
export async function GET() {
  try {
    return NextResponse.json(await getState());
  } catch (e) {
    return apiError(e);
  }
}
