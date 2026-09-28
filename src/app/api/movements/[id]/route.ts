import { writeCommand } from "@/lib/api";
type Context = { params: Promise<{ id: string }> };
export async function PUT(r: Request, c: Context) {
  return writeCommand(r, ["movement"], (await c.params).id);
}
export async function DELETE(r: Request, c: Context) {
  return writeCommand(r, ["void"], (await c.params).id);
}
