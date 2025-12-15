import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';

const content = readFileSync('data/goodreads_library_export.csv', 'utf-8');
const records = parse(content, { columns: true }) as Record<string, string>[];

const shelves = new Map<string, number>();

records.forEach(r => {
  const bs = r['Bookshelves'] || '';
  bs.split(',').map(s => s.trim()).filter(s => s.length > 0 && s !== 'to-read').forEach(shelf => {
    shelves.set(shelf, (shelves.get(shelf) || 0) + 1);
  });
});

console.log('Top shelves/genres in your Goodreads:\n');
[...shelves.entries()].sort((a,b) => b[1]-a[1]).slice(0,40).forEach(([s,c]) => console.log(`${c.toString().padStart(4)} ${s}`));
