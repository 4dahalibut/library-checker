import { importGoodreadsCSV } from "./db.js";

const csvFile = process.argv[2] || "data/goodreads_library_export.csv";
console.log(`Importing from ${csvFile}...`);
const count = importGoodreadsCSV(csvFile);
console.log(`Imported ${count} books to data/library.db`);
