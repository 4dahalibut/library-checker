import { importGoodreadsCSV, getUserByUsername } from "./db.js";

const csvFile = process.argv[2] || "data/goodreads_library_export.csv";
const username = process.argv[3];

if (!username) {
  console.error("Usage: npm run import <csv-file> <username>");
  process.exit(1);
}

const user = getUserByUsername(username);
if (!user) {
  console.error(`User "${username}" not found. Register an account first.`);
  process.exit(1);
}

console.log(`Importing from ${csvFile} for user "${user.username}"...`);
const count = importGoodreadsCSV(csvFile, user.id);
console.log(`Imported ${count} books to data/library.db`);
