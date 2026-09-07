import { decide } from "../decision";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return decide(request, context, "rejected");
}
