// @ts-nocheck
import fs from 'fs';
import path from 'path';
import { algoliasearch } from 'algoliasearch';

// Configuration — set ALGOLIA_APP_ID and ALGOLIA_API_KEY env vars before running
const APP_ID = process.env.ALGOLIA_APP_ID || '';
const API_KEY = process.env.ALGOLIA_API_KEY || '';

if (!APP_ID || !API_KEY) {
  console.error('Missing env vars: ALGOLIA_APP_ID and ALGOLIA_API_KEY are required');
  console.error('Usage: ALGOLIA_APP_ID=xxx ALGOLIA_API_KEY=yyy npx ts-node scripts/fetch-courses.ts');
  process.exit(1);
}
const INDEX_NAME = 'classes';
const OUTPUT_FILE = path.join(process.cwd(), 'public/data/courses.json');

const TARGET_TERMS = [
    'Autumn 2025',
    'Winter 2026',
    'Spring 2026'
];

async function fetchCourses() {
  console.log('Initializing Algolia client...');
  const client = algoliasearch(APP_ID, API_KEY);
  let allCourses: any[] = [];

  const fetchPage = async (filters: string, page = 0) => {
     const res = await client.searchSingleIndex({
        indexName: INDEX_NAME,
        searchParams: {
            query: '',
            filters: filters,
            page: page,
            hitsPerPage: 100
        }
    });
    return res;
  };

  const getAllPages = async (filters: string) => {
      let page = 0;
      let results: any[] = [];
      while(true) {
          const res = await fetchPage(filters, page);
          results.push(...res.hits);
          if (page >= res.nbPages - 1) break;
          page++;
      }
      return results;
  };

  try {
    for (const term of TARGET_TERMS) {
        console.log(`\nProcessing Term: ${term}...`);
        
        const initialRes = await client.searchSingleIndex({
            indexName: INDEX_NAME,
            searchParams: {
                query: '',
                filters: `termOffered:"${term}"`,
                facets: ['deptName'],
                hitsPerPage: 1,
                maxValuesPerFacet: 1000
            }
        });

        const deptObj = initialRes.facets?.['deptName'] || {};
        const departments = Object.keys(deptObj);
        
        console.log(`  Found ${departments.length} departments.`);
        
        for (const dept of departments) {
            const safeDept = dept.replace(/"/g, '\\"');
            const baseFilter = `termOffered:"${term}" AND deptName:"${safeDept}"`;
            
            const checkRes = await client.searchSingleIndex({
                indexName: INDEX_NAME,
                searchParams: { query: '', filters: baseFilter, hitsPerPage: 1 }
            });
            
            const count = checkRes.nbHits;
            
            if (count <= 1000) {
                 process.stdout.write(`    ${dept} (${count})... `);
                 const hits = await getAllPages(baseFilter);
                 allCourses.push(...hits);
                 process.stdout.write(`Done.\n`);
            } else {
                console.log(`    ${dept} (${count}) > 1000. Splitting by Career...`);
                const careerRes = await client.searchSingleIndex({
                    indexName: INDEX_NAME,
                    searchParams: {
                        query: '',
                        filters: baseFilter,
                        facets: ['acadCareerDescr'],
                        hitsPerPage: 1
                    }
                });
                const careers = Object.keys(careerRes.facets?.['acadCareerDescr'] || {});
                
                for (const career of careers) {
                    const careerFilter = `${baseFilter} AND acadCareerDescr:"${career}"`;
                    const careerHits = await getAllPages(careerFilter);
                    console.log(`      - ${career}: ${careerHits.length}`);
                    allCourses.push(...careerHits);
                }
            }
        }
    }

    console.log(`\nTotal fetched: ${allCourses.length}`);
    
    // MASTER DEDUPLICATION LOGIC
    // We group by "subject + code" (e.g. "CS 106A")
    // We merge sections, terms, and instructors.
    
    const courseMap = new Map();

    for (const hit of allCourses) {
        // Construct unique key for the COURSE (not the section)
        // Some codes might be "CS 106A" vs "CS106A", normalize if needed.
        // Data usually has 'subject'="CS" and 'code'="106A" or 'catalogNbr'="106A"
        const subject = hit.subject;
        const code = hit.catalogNbr || hit.code;
        const courseKey = `${subject}${code}`; // e.g., CS106A

        if (!courseMap.has(courseKey)) {
            courseMap.set(courseKey, {
                id: courseKey, // Use Code as ID for master listing
                subject: subject,
                code: code,
                title: hit.courseTitle,
                description: hit.courseDescr,
                units: (hit.units && hit.units.length) ? hit.units.join('-') : '0',
                grading: hit.gradingBasisDescr,
                instructors: new Set(), // Set for unique instructors
                terms: new Set(), // Set for unique terms
                dept: hit.deptName,
                meetings: [], // Collect all meeting patterns
                sections: [] // Store full section details
            });
        }

        const course = courseMap.get(courseKey);
        
        // Merge Metadata
        if (hit.termOffered) course.terms.add(hit.termOffered);

        // Populate Section Data
        const sectionData = {
            term: hit.termOffered,
            classId: hit.classNbr,
            sectionNumber: hit.classSection,
            component: hit.components ? hit.components[0] : hit.componentPrimary,
            units: (hit.units && hit.units.length) ? hit.units.join('-') : '0',
            grading: hit.gradingBasisDescr,
            classLevel: hit.acadCareerDescr,
            instructionalMode: hit.instructionModeDescr,
            status: hit.enrlStatDescr,
            enrolled: hit.enrlTot,
            capacity: hit.enrlCap,
            waitlist: hit.waitTot,
            waitlistMax: hit.waitCap,
            openSeats: Math.max(0, hit.enrlCap - hit.enrlTot),
            startDate: hit.startDt,
            endDate: hit.endDt,
            gers: hit.geRequirements || [],
            meetings: (hit.meetings || []).map((m: any) => ({
                days: m.daysOfWeek,
                time: (m.startTime && m.endTime) ? `${m.startTime} - ${m.endTime}` : 'TBA',
                location: m.facilityDescr || 'TBA',
                instructors: m.instructors ? m.instructors.map((i: any) => i.displayName) : []
            }))
        };
        
        course.sections.push(sectionData);
        
        // Merge Meetings (Legacy / for Calendar View)
        if (hit.meetings && hit.meetings.length > 0) {
            hit.meetings.forEach((m: any) => {
                // Only add if we have time info
                if (m.startTime && m.endTime && m.daysOfWeek) {
                    // Check for duplicates in existing meetings
                    const isDuplicate = course.meetings.some((existing: any) => 
                        existing.daysOfWeek === m.daysOfWeek &&
                        existing.startTime === m.startTime &&
                        existing.endTime === m.endTime &&
                        existing.term === hit.termOffered // Distinguish by term
                    );
                    
                    if (!isDuplicate) {
                        course.meetings.push({
                            daysOfWeek: m.daysOfWeek,
                            startTime: m.startTime,
                            endTime: m.endTime,
                            facilityDescr: m.facilityDescr,
                            term: hit.termOffered // Tag meeting with term
                        });
                    }
                }
            });
        }
        
        const hitInstructors = hit.meetings && hit.meetings[0] && hit.meetings[0].instructors 
            ? hit.meetings[0].instructors.map((i: any) => i.displayName) 
            : (hit.instructors ? hit.instructors.map((i:any) => i.displayName || i.name) : []);
            
        hitInstructors.forEach((i: string) => course.instructors.add(i));
        
        // Maybe update units/grading if they differ? usually consistent per year.
    }

    // Convert Sets to Arrays for JSON
    const masterCourses = Array.from(courseMap.values()).map(c => ({
        ...c,
        instructors: Array.from(c.instructors),
        terms: Array.from(c.terms).sort(), // Sort terms chronologically if possible, string sort ok for now
    }));

    console.log(`Unique master courses: ${masterCourses.length}`);

    // Write
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(masterCourses, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('Error fetching courses:', error);
    process.exit(1);
  }
}

fetchCourses();
