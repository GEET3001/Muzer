// Shared queue types + client-side ordering used by both the host dashboard and
// the guest session view, so their optimistic updates stay identical to the
// server's ordering.

export type QueueItem = {
  id: string;
  url: string;
  title: string;
  smallImg: string;
  bigImg: string;
  extractedId: string;
  upvotes: number;
  myVote: number;
  createdAt: string;
};

export type QueueResponse = {
  currentStreamId: string | null;
  items: QueueItem[];
};

// Re-sort exactly like the server: highest net votes first, ties broken by
// whoever was added earliest (ISO timestamps compare chronologically).
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) =>
      b.upvotes - a.upvotes ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
  );
}

// Optimistic result of clicking a vote button, mirroring the server's toggle
// rules (clicking the vote you already have clears it).
export function applyVote(
  items: QueueItem[],
  id: string,
  dir: 1 | -1
): QueueItem[] {
  const next = items.map((it) => {
    if (it.id !== id) return it;
    const active = it.myVote === dir;
    const myVote = active ? 0 : dir;
    // Net change = new contribution - old contribution.
    const delta = myVote - it.myVote;
    return { ...it, myVote, upvotes: it.upvotes + delta };
  });
  return sortQueue(next);
}
