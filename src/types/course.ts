export interface Section {
  term: string;
  classId: number;
  sectionNumber: string;
  component: string;
  units: number | string;
  grading: string;
  classLevel: string;
  instructionalMode: string;
  status: string;
  enrolled: number;
  capacity: number;
  waitlist: number;
  waitlistMax: number;
  openSeats: number;
  startDate: string;
  endDate: string;
  meetings: {
    days: string;
    time: string;
    location: string;
    instructors: string[];
  }[];
  finalExam?: {
    date: string;
    location: string;
  };
  gers?: string[];
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
  term?: string;
  terms?: string[];
  dept?: string;
  sections?: Section[];
  selectedTerm?: string; // The term selected by the user for their schedule
  selectedSectionId?: number; // The specific section (classId) selected
  selectedUnits?: number; // When course/section has variable units (e.g. 3-4), the user's choice
  optionalMeetings?: string[]; // Array of meeting keys that are marked as optional/not in class
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

export interface CourseEvaluation {
  term: string;
  instructor: string;
  courseCode: string;
  respondents: string;
  questions: EvalQuestion[];
  comments: string[];
}
