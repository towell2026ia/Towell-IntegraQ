declare module "*rncp-followup.mjs" {
  export default function handler(request: Request, context: { deploy?: { context?: string } }): Promise<Response>;
  export const config: { schedule: string };
}
