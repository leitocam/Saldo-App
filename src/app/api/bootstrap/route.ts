import { writeCommand } from "@/lib/api";
export const POST = (r: Request) => writeCommand(r, ["bootstrap"]);
