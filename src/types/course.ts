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
  optionalMeetings?: string[]; // Array of meeting keys that are marked as optional/not in class
}
