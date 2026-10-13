export type ChatwootCursor = {
  updatedAt: string;
  id: string;
};

export type ProjectedMessage = {
  messageId: string;
  conversationId: string;
  accountId: string;
  inboxId: string;
  direction: "incoming" | "outgoing";
  kind: "customer" | "human" | "template" | "automation" | "system";
  private: boolean;
  deliveryStatus: "sent" | "delivered" | "read" | "failed" | null;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SyncResult = {
  status: "updated" | "current" | "busy";
  processed: number;
  lastSuccessAt: string | null;
};

export type SyncFreshness = {
  status: "fresh" | "stale";
  lastSuccessAt: string | null;
  warning: string | null;
};
