// Loads a sample record from tests/fixtures and moves its dates to "2 days ago",
// so the sample invoice never becomes "unpaid past the limit" (30 days) as real time passes.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'fixtures');
const ymd = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
module.exports = function fixture(rel){
  const o = JSON.parse(fs.readFileSync(path.join(DIR, rel)));
  const day = new Date(Date.now() - 2 * 864e5), stamp = day.toISOString();
  if (o.date) o.date = ymd(day);
  if (o.createdAt) o.createdAt = stamp;
  if (o.extraction && o.extraction.at) o.extraction.at = stamp;
  return o;
};
