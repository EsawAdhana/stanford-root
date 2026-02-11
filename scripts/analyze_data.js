const fs = require('fs');
const data = JSON.parse(fs.readFileSync('stanford_majors_data.json', 'utf8'));

console.log(`Total Majors: ${data.length}`);
let success = 0;
let failed = 0;
let errors = 0;

data.forEach(m => {
    if (m.error) {
        errors++;
    } else if (m.requirements && Object.keys(m.requirements).length > 0) {
        success++;
    } else {
        failed++;
    }
});

console.log(`Success (with requirements): ${success}`);
console.log(`Failed (empty requirements): ${failed}`);
console.log(`Errors: ${errors}`);

// List some failed ones
console.log('Sample failed majors:');
data.filter(m => !m.error && (!m.requirements || Object.keys(m.requirements).length === 0)).slice(0, 10).forEach(m => console.log(` - ${m.name}`));
