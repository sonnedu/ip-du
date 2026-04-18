import { formatResult } from '../src/services/db.js';

const mockCity = {
  "city": "Mountain View",
  "country_code": "US",
  "latitude": 37.422000885009766,
  "longitude": -122.08499908447266,
  "postcode": "",
  "state1": "California",
  "state2": "",
  "timezone": ""
};

const result = formatResult('8.8.8.8', mockCity, null);
console.log(JSON.stringify(result, null, 2));
