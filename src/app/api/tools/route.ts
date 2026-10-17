import { writeCommand } from "@/lib/api";
export const POST = (request: Request) =>
  writeCommand(request, ["planning", "batch"]);
