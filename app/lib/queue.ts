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
  // Cumulative paid bid in paise. Tracks with any bid outrank zero-bid tracks
  // regardless of votes.
  bidAmountUnits: number;
  createdAt: string;
};

export type QueueResponse = {
  currentStreamId: string | null;
  items: QueueItem[];
  // Whether the session host can currently receive bid payouts. The bid UI is
  // only actionable when this is true (host linked a Razorpay account AND
  // payouts are live). Derived server-side in GET /api/streams.
  host: { acceptsPayments: boolean };
};

// The one queue ordering, shared by every consumer: highest paid bid first, then
// highest net votes, ties broken by whoever was added earliest (ISO timestamps
// compare chronologically). Explicit tie-break — never relies on sort stability.
//
// GET /api/streams, POST /api/streams/next and the clients' optimistic re-sort
// all call this. Keeping it in one place is what guarantees they can't drift:
// a queue that reorders differently on the server than in the UI is the bug
// this function exists to make impossible.
export type QueueRank = {
  bidAmountUnits: number;
  upvotes: number;
  createdAt: string;
};

export function compareQueue(a: QueueRank, b: QueueRank): number {
  return (
    b.bidAmountUnits - a.bidAmountUnits ||
    b.upvotes - a.upvotes ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
  );
}

export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(compareQueue);
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
