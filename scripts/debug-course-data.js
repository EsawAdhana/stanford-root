
const { algoliasearch } = require('algoliasearch');

const APP_ID = 'RXGHAPCKOF';
const API_KEY = 'MWRhYWQxYTNmOTdjNzhmMGNmOTI2YmFlMDRjZmMwMjRjYzQxNDcwMGM4OGM2MTQ2OWJjODAyYzYwMWRlMmFkOXJlc3RyaWN0SW5kaWNlcz1jbGFzc2VzJnZhbGlkVW50aWw9MTc2Nzk0MDczMg==';
const INDEX_NAME = 'classes';

async function debugFetch() {
  const client = algoliasearch(APP_ID, API_KEY);
  
  // Search for AA 102 specifically
  const res = await client.searchSingleIndex({
      indexName: INDEX_NAME,
      searchParams: {
          query: 'AA 102',
          hitsPerPage: 1
      }
  });

  if (res.hits.length > 0) {
      console.log(JSON.stringify(res.hits[0], null, 2));
  } else {
      console.log('No hits found.');
  }
}

debugFetch();
