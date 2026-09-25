export interface Section {
  term: string;
  classId: number;
  sectionNumber: string;
  component: string;
  units: number | string;
  grading: string;
  /** Omitted when upstream sends nothing (currently always). Callers infer the level from the course code. */
  classLevel?: string;
  instructionalMode: string;
  status: string;
  enrolled: number;
  capacity: number;
  waitlist: number;
  waitlistMax: number;
  startDate: string;
  endDate: string;
  meetings: {
    /** Meeting fields are omitted rather than sent empty: 83% of sections are unscheduled (TBA). */
    days?: string;
    time?: string;
    location?: string;
    instructors?: string[];
  }[];
  finalExam?: {
    date: string;
    location: string;
  };
  gers?: string[];
  /**
   * The meeting's shared seats, present only when it is cross-listed. Each
   * listing's own `capacity` is an allotment; this cap is the room, and it is
   * the one that says whether the class has a seat. Absent in dumps written
   * before the scraper read it.
   */
  combined?: CombinedSeats;
}

export interface CombinedSeats {
  enrolled: number;
  capacity: number;
  waitlist: number;
  waitlistMax: number;
}

export interface Course {
  id: string;
  subject: string;
  code: string;
  title: string;
  description: string;
  units: string;
  grading: string;
  instructors: string[];
  terms?: string[];
  sections?: Section[];
  selectedTerm?: string; // The term selected by the user for their schedule
  selectedSectionIds?: number[]; // Selected sections (classIds), at most one per component (e.g. a LEC and a DIS)
  selectedUnits?: number; // When course/section has variable units (e.g. 3-4), the user's choice
  optionalMeetings?: string[]; // Array of meeting keys that are marked as optional/not in class
  color?: string; // User-selected color theme for the course (e.g. 'sky', 'emerald')
  /** Precomputed from evaluations (hrs/wk median) */
  hours?: number;
  /** Precomputed from evaluations: pooled mean of every 1-5 rating response */
  quality?: number;
  /** Precomputed: percentile rank (1-100) of `quality` within `rankScope` */
  qualityPct?: number;
  /**
   * Subject `qualityPct` was ranked within, or undefined when the subject had too few
   * rated classes and the rank fell back to every rated course at Stanford.
   */
  rankScope?: string;
  /** Precomputed: how many individual 1-5 responses `quality` is based on */
  qualityN?: number;
  /** Precomputed per-category adjusted score, sample size and percentile */
  ratingBreakdown?: Partial<Record<'quality' | 'learning' | 'organization', RatingStat>>;
  /**
   * Other catalog codes that appear on the same evaluation report as this one, derived
   * from the evaluations' own course_code. Grouped alongside the codes the title
   * declares, because paired undergrad/grad listings share students without the catalog
   * ever declaring them cross-listed.
   */
  crossListWith?: string[];
  /** Precomputed: not scheduled in any of the three prior catalogs, and no evaluations from those years */
  isNew?: boolean;
}

export interface RatingStat {
  /** 1-5, shrunk toward this category's corpus mean by sample size */
  score: number;
  /** Individual responses behind `score` */
  n: number;
  /** Percentile rank (1-100) of `score` within this category and `scope`. 100 = highest. */
  pct: number;
  /** Subject `pct` was ranked within; null/undefined means all rated Stanford courses. */
  scope?: string | null;
}

// --- Course Evaluation Types ---

export interface EvalOption {
  text: string;
  weight: number;
  count: number;
  pct: string;
}

export interface EvalQuestion {
  text: string;
  type: 'rating' | 'numeric';
  mean: number;
  median: number;
  std: number;
  responseRate: string;
  options: EvalOption[];
}

/**
 * How a student comment reads.
 *
 * `advice` is the residual, and it is the one worth explaining: the comment
 * scored low on both praise and blame, meaning the student never passed a
 * verdict on the course. In this corpus that is overwhelmingly practical
 * instruction -- "start every PSET early", "go to lecture" -- because Carta
 * asks what you would tell a student considering the course, so advice is the
 * default register. Low on both is not the same as balanced between them;
 * that case is `mixed`.
 */
export type CommentSentiment = 'positive' | 'negative' | 'mixed' | 'advice';

export interface CourseEvaluation {
  term: string;
  instructor: string;
  courseCode: string;
  respondents: string;
  questions: EvalQuestion[];
  comments: string[];
  /**
   * Sentiment for each entry of `comments`, index-aligned and the same length.
   * `null` where that comment has not been scored yet, which is not the same as
   * neutral. Kept parallel rather than folded into `comments` so the existing
   * string[] consumers are untouched.
   */
  commentSentiment?: (CommentSentiment | null)[];
  /** Median % of class sessions attended online (from eval survey) */
  onlineAttendancePct?: number;
  /** Median % of class sessions attended in person (from eval survey) */
  inPersonAttendancePct?: number;
}

/**
 * Carta's class-level enrollment breakdown for one course, pooled over every term
 * Carta holds. `levels` is keyed by Carta's own labels; the display order and the
 * short names live in CLASS_YEAR_LEVELS so an unrecognised label is dropped from the
 * chart rather than rendered raw.
 */
export interface ClassYearBreakdown {
  levels: Record<string, number>;
  /** Sum of levels, and the denominator every percentage on the chart uses. */
  total: number;
}
