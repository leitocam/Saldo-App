import { NextResponse } from "next/server";
import { paymentMethods } from "@/lib/p2p";
import { apiError } from "@/lib/api";
export async function GET() {
  try {
    return NextResponse.json(await paymentMethods());
  } catch (e) {
    return apiError(e);
  }
}
