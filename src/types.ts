export interface Flashcard {
  id: string;
  uid: string;
  front: string;
  back: string;
  moduleName: string; // This is the lesson name
  createdAt: number;
  nextReviewDate: number; // Timestamp
  interval: number; // Days
  reps: number; // Number of successful repetitions
  ease: number; // Ease factor for SRS (default 2.5)
  studentName?: string;
}

export interface Module {
  id: string;
  uid: string;
  name: string;
  content: string;
  cardCount: number;
  group: string; // e.g., "Module 1"
  unlocked?: boolean;
  studentName?: string;
}
