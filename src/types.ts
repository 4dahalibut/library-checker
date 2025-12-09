export interface GoodreadsBook {
  bookId: string;
  title: string;
  author: string;
  isbn: string;
  isbn13: string;
  dateAdded: Date;
  shelf: string;
  avgRating: number;
  numRatings?: number;
}

export interface LibraryAvailability {
  metadataId: string;
  title: string;
  author: string;
  format: string;
  status: "AVAILABLE" | "UNAVAILABLE" | "NOT_FOUND";
  availableCopies: number;
  totalCopies: number;
  heldCopies: number;
  catalogUrl: string;
  squirrelHillAvailable: boolean;
}

export interface BookWithAvailability {
  goodreads: GoodreadsBook;
  library: LibraryAvailability | null;
  lastChecked: Date;
}

export interface CacheData {
  books: BookWithAvailability[];
  lastRefresh: string;
}
