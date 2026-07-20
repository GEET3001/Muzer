import { prismaClient } from "./db";

/**
 * Two-code auth gate. A user may view/add/vote in a session only if they are
 * the host or a member who joined with the correct join code + access code.
 */
export async function isParticipant(
  userId: string,
  session: { id: string; hostId: string }
): Promise<boolean> {
  if (session.hostId === userId) return true;

  const member = await prismaClient.sessionMember.findUnique({
    where: { sessionId_userId: { sessionId: session.id, userId } },
  });
  return Boolean(member);
}

/**
 * True once a user runs at least one room. Payout setup is host-only, and
 * "hosts a session" is the only notion of host the schema has — there's no
 * separate host flag on User.
 */
export async function isHost(userId: string): Promise<boolean> {
  const hosted = await prismaClient.session.findFirst({
    where: { hostId: userId },
    select: { id: true },
  });
  return Boolean(hosted);
}
