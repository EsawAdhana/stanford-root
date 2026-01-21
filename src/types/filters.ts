export interface FilterState {
  q: string;
  depts: string[];
  terms: string[];
  units: number[]; // [min, max]
  days: string[];
  status: string[]; // Open, Waitlist
}
