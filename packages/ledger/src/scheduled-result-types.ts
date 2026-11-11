// A destination is chosen by the owner, never read from the produced file.
export type ResultDestination = { kind: 'desk' } | { kind: 'gmail'; connector: string; to: string };
export type ResultEvidence = {
  producerRun?: number;
  savedAt?: string;
  reviewerRun?: number;
  reviewedAt?: string;
  output?: string;
  sha256?: string;
  payload?: { subject: string; body: string; hash: string };
  gaps: { from: number; to: number; cause: 'unknown' }[];
};
export type DeliveryState = 'waiting' | 'ready' | 'sending' | 'uncertain' | 'accepted';
