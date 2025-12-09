import { importGoodreadsCSV } from "./db.js";

const csvFile = process.argv[2] || "goodreads_library_export.csv";
console.log(`Importing from ${csvFile}...`);
const count = importGoodreadsCSV(csvFile);
console.log(`Imported ${count} books to library.db`);
