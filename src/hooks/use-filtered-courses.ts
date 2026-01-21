import { useMemo } from 'react';
import { useCourseStore } from '@/lib/store';
import { useCartStore } from '@/lib/cart-store';
import { useQueryState, parseAsArrayOf, parseAsString, parseAsBoolean } from 'nuqs';
import { parseMeetingTimes, timeToMinutes, isMeetingOptional } from '@/lib/schedule-utils';
import { getSchoolFromSubject } from '@/lib/utils';

export function useFilteredCourses() {
  const { courses, isLoading } = useCourseStore();
  const cartItems = useCartStore(state => state.items);
  
  const [query] = useQueryState('q', { defaultValue: '' });
  const [selectedDepts] = useQueryState('depts', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedTerms] = useQueryState('terms', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedFormats] = useQueryState('formats', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedStatus] = useQueryState('status', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedLevels] = useQueryState('levels', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedGers] = useQueryState('gers', parseAsArrayOf(parseAsString).withDefault([]));
  const [selectedSchools] = useQueryState('schools', parseAsArrayOf(parseAsString).withDefault([]));
  
  const [unitRanges] = useQueryState('units', parseAsArrayOf(parseAsString).withDefault([]));
  const [timeRanges] = useQueryState('times', parseAsArrayOf(parseAsString).withDefault([]));
  const [hideConflicts] = useQueryState('hideConflicts', parseAsBoolean.withDefault(false));
  const [excludedWords] = useQueryState('exclude', parseAsArrayOf(parseAsString).withDefault([]));

  const filteredCourses = useMemo(() => {
    // Start with all courses
    let result = courses;

    // Filter by Excluded Keywords
    if (excludedWords && excludedWords.length > 0) {
        result = result.filter(c => {
            const textToCheck = `${c.title} ${c.description} ${c.code}`.toLowerCase();
            return !excludedWords.some(word => textToCheck.includes(word.toLowerCase()));
        });
    }

    // Filter by Department
    if (selectedDepts && selectedDepts.length > 0) {
      result = result.filter(c => selectedDepts.includes(c.subject));
    }

    // Filter by Term
    if (selectedTerms && selectedTerms.length > 0) {
        result = result.filter(c => {
            if (c.terms) {
                return c.terms.some(t => selectedTerms.includes(t));
            }
            return c.term && selectedTerms.includes(c.term);
        });
    }

    // Filter by Format (Component)
    if (selectedFormats && selectedFormats.length > 0) {
        result = result.filter(c => {
            if (c.sections && c.sections.length > 0) {
                return c.sections.some(s => s.component && selectedFormats.includes(s.component));
            }
            return false;
        });
    }

    // Filter by Status (Open/Waitlist)
    if (selectedStatus && selectedStatus.length > 0) {
        result = result.filter(c => {
            if (c.sections && c.sections.length > 0) {
                return c.sections.some(s => s.status && selectedStatus.includes(s.status));
            }
            return false;
        });
    }

    // Filter by Level (Undergrad/Grad etc)
    if (selectedLevels && selectedLevels.length > 0) {
        result = result.filter(c => {
            if (c.sections && c.sections.length > 0) {
                return c.sections.some(s => s.classLevel && selectedLevels.includes(s.classLevel));
            }
            return false;
        });
    }

    // Filter by GERs
    if (selectedGers && selectedGers.length > 0) {
        result = result.filter(c => {
            if (c.sections && c.sections.length > 0) {
                return c.sections.some(s => s.gers && s.gers.some(g => selectedGers.includes(g)));
            }
            return false;
        });
    }

    // Filter by Unit Range
    if (unitRanges && unitRanges.length > 0) {
        result = result.filter(c => {
             const checkUnits = (uStr: string | number) => {
                 if (!uStr) return false;
                 const u = typeof uStr === 'string' ? parseFloat(uStr) : uStr;
                 if (isNaN(u)) return false;
                 
                 // Check if it falls into ANY of the selected ranges
                 return unitRanges.some(range => {
                     if (range === '1') return u >= 1 && u < 2;
                     if (range === '2') return u >= 2 && u < 3;
                     if (range === '3') return u >= 3 && u < 4;
                     if (range === '4') return u >= 4 && u < 5;
                     if (range === '5+') return u >= 5;
                     return false;
                 });
             };

             if (c.sections && c.sections.length > 0) {
                 return c.sections.some(s => checkUnits(s.units));
             }
             const mainUnits = parseFloat(c.units);
             if (!isNaN(mainUnits)) return checkUnits(mainUnits);
             return false;
        });
    }

    // Filter by Time Range
    if (timeRanges && timeRanges.length > 0) {
        const timeToHour = (timeStr: string) => {
             if (!timeStr) return -1;
             const [time, modifier] = timeStr.split(' ');
             let [hours] = time.split(':').map(Number);
             if (modifier === 'PM' && hours < 12) hours += 12;
             if (modifier === 'AM' && hours === 12) hours = 0;
             return hours;
        };

        result = result.filter(c => {
             if (c.sections && c.sections.length > 0) {
                 return c.sections.some(s => s.meetings.some(m => {
                     const startHour = timeToHour(m.time.split('-')[0].trim());
                     if (startHour === -1) return false;
                     
                     return timeRanges.some(range => {
                         if (range === 'early-morning') return startHour < 10;
                         if (range === 'morning') return startHour >= 10 && startHour < 12;
                         if (range === 'afternoon') return startHour >= 12 && startHour < 14;
                         if (range === 'late-afternoon') return startHour >= 14 && startHour < 17;
                         if (range === 'evening') return startHour >= 17;
                         return false;
                     });
                 }));
             }
             return false;
        });
    }

    // Filter by Conflicts
    if (hideConflicts) {
        const hasOverlap = (m1: any, m2: any, cartItem?: any) => {
             // Check Days - but exclude optional days from cartItem
             let commonDays = m1.days.filter((d: string) => m2.days.includes(d));
             
             // If cartItem is provided, filter out optional days
             if (cartItem) {
                 commonDays = commonDays.filter((day: string) => {
                     return !isMeetingOptional(cartItem, day, m2.startTime, m2.endTime);
                 });
             }
             
             if (commonDays.length === 0) return false;
             
             // Check Times
             const start1 = timeToMinutes(m1.startTime);
             const end1 = timeToMinutes(m1.endTime);
             const start2 = timeToMinutes(m2.startTime);
             const end2 = timeToMinutes(m2.endTime);
             
             return start1 < end2 && start2 < end1;
        };

        const parseSectionMeetings = (section: any) => {
            return section.meetings.flatMap((m: any) => {
                let days: string[] = [];
                if (typeof m.days === 'string') days = m.days.split(/[ ,]+/);
                
                // Normalize Days (Mon, Tue...)
                const normalizedDays = days.map((d: string) => {
                    const lower = d.toLowerCase();
                    if (lower.startsWith('m')) return 'Mon';
                    if (lower.startsWith('tu')) return 'Tue';
                    if (lower.startsWith('w')) return 'Wed';
                    if (lower.startsWith('th')) return 'Thu';
                    if (lower.startsWith('f')) return 'Fri';
                    return '';
                }).filter(Boolean);

                let startTime = '', endTime = '';
                if (m.time && m.time.includes('-')) {
                    [startTime, endTime] = m.time.split('-').map((s: string) => s.trim());
                }

                if (!startTime) return [];

                return [{
                    days: normalizedDays,
                    startTime,
                    endTime
                }];
            });
        };

        result = result.filter(c => {
             if (!c.sections || c.sections.length === 0) return true;
             
             let sectionsToCheck = c.sections;
             if (selectedTerms && selectedTerms.length > 0) {
                 sectionsToCheck = sectionsToCheck.filter(s => selectedTerms.includes(s.term));
             }
             
             if (sectionsToCheck.length === 0) return true;

             // A course is valid if AT LEAST ONE section does not overlap
             return sectionsToCheck.some(section => {
                 const cartItemsForTerm = cartItems.filter(item => item.selectedTerm === section.term);
                 if (cartItemsForTerm.length === 0) return true;
                 
                 const sectionMeetings = parseSectionMeetings(section);
                 if (sectionMeetings.length === 0) return true;

                 const isOverlapping = cartItemsForTerm.some(cartItem => {
                      const cartMeetings = parseMeetingTimes(cartItem, cartItem.selectedTerm);
                      // Check conflicts, but pass cartItem to hasOverlap to exclude optional days
                      return cartMeetings.some(cm => 
                          sectionMeetings.some((sm: any) => hasOverlap(sm, cm, cartItem))
                      );
                 });
                 
                 return !isOverlapping;
             });
        });
    }
    
    // Filter by School
    if (selectedSchools && selectedSchools.length > 0) {
         result = result.filter(c => {
             const school = getSchoolFromSubject(c.subject);
             return selectedSchools.includes(school);
         });
    }


    // Filter by Query
    if (query) {
      const lowerQuery = query.toLowerCase().trim();
      const parts = lowerQuery.split(' ');
      const potentialSubject = parts[0].toUpperCase();
      
      const allSubjects = new Set(courses.map(c => c.subject));
      const isSubjectSearch = allSubjects.has(potentialSubject);

      if (isSubjectSearch) {
          result = result.filter(c => c.subject === potentialSubject);
          
          if (parts.length > 1) {
              const remainingQuery = parts.slice(1).join(' ');
              result = result.filter(c => {
                  if (c.code.toLowerCase().includes(remainingQuery)) return true;
                  if (c.title.toLowerCase().includes(remainingQuery)) return true;
                  return false;
              });
          }
      } else {
          result = result.filter(c => {
            const subjectCode = `${c.subject} ${c.code}`.toLowerCase();
            if (subjectCode.startsWith(lowerQuery)) return true;
            if (c.code.toLowerCase().includes(lowerQuery)) return true;
            if (c.title.toLowerCase().includes(lowerQuery)) return true;
            if (c.instructors && c.instructors.some(i => i.toLowerCase().includes(lowerQuery))) return true;
            return false;
          });
      }
    }
    
    // Sort alphabetically by Subject then Code
    const sortedResult = [...result].sort((a, b) => {
        const subjectCompare = a.subject.localeCompare(b.subject);
        if (subjectCompare !== 0) return subjectCompare;
        
        return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortedResult;
  }, [courses, query, selectedDepts, selectedTerms, selectedFormats, selectedStatus, selectedLevels, selectedGers, selectedSchools, unitRanges, timeRanges, hideConflicts, cartItems, excludedWords]);

  return { courses: filteredCourses, isLoading };
}
