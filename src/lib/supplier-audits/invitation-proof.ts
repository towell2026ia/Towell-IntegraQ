import { createHash, randomBytes } from "node:crypto";

export function invitationLocator(invite: unknown) {
  if (typeof invite !== "string" || !/^[a-f0-9]{64}$/.test(invite)) return null;
  return createHash("sha256").update(invite).digest("hex");
}

export function invitationDigest(invite: unknown, code: unknown) {
  if (typeof invite !== "string" || !/^[a-f0-9]{64}$/.test(invite) ||
      typeof code !== "string" || code.length > 64) return null;
  const normalized = code.trim().replace(/-/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) return null;
  return createHash("sha256").update(invite + ":" + normalized).digest("hex");
}

export function newInvitationProof() {
  const invite = randomBytes(32).toString("hex");
  const code = randomBytes(16).toString("hex").match(/.{4}/g)!.join("-");
  return { invite, code, digest: invitationDigest(invite, code)! };
}
