#!/usr/bin/env python3
"""
Cross-reference Goodreads reading list with Carnegie Library of Pittsburgh catalog.
Uses the BiblioCommons gateway API.
"""

import csv
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass
class LibraryResult:
    title: str
    author: str
    format: str
    status: str
    available_copies: int
    total_copies: int
    branches: list[str]
    catalog_url: str


def search_library(query: str, search_by_isbn: str | None = None) -> list[LibraryResult]:
    """Search the Carnegie Library of Pittsburgh catalog."""

    # If we have an ISBN, search by that first (more precise)
    if search_by_isbn:
        search_query = search_by_isbn
    else:
        search_query = query

    encoded_query = urllib.parse.quote(search_query)
    url = f"https://gateway.bibliocommons.com/v2/libraries/acl/bibs/search?query={encoded_query}&searchType=smart&limit=10&locale=en-US"

    headers = {
        "accept": "application/json",
        "origin": "https://acl.bibliocommons.com",
        "referer": "https://acl.bibliocommons.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }

    req = urllib.request.Request(url, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
    except Exception as e:
        print(f"  Error searching for '{query}': {e}")
        return []

    results = []
    bibs = data.get("entities", {}).get("bibs", {})

    for bib_id, bib in bibs.items():
        brief = bib.get("briefInfo", {})
        avail = bib.get("availability", {})

        # Get branch availability from the search facets
        branches = []
        for field in data.get("catalogSearch", {}).get("fields", []):
            if field.get("id") == "STATUS":
                for f in field.get("fieldFilters", []):
                    if f.get("count", 0) > 0 and not f.get("value", "").startswith("_"):
                        branches.append(f.get("label", f.get("value", "")))

        results.append(LibraryResult(
            title=brief.get("title", "Unknown"),
            author=", ".join(brief.get("authors", [])),
            format=brief.get("format", "Unknown"),
            status=avail.get("status", "Unknown"),
            available_copies=avail.get("availableCopies", 0),
            total_copies=avail.get("totalCopies", 0),
            branches=branches,
            catalog_url=f"https://acl.bibliocommons.com/v2/record/{bib_id}",
        ))

    return results


def load_goodreads_csv(filepath: str) -> list[dict]:
    """Load books from Goodreads CSV export."""
    books = []
    with open(filepath, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Goodreads exports have an "Exclusive Shelf" column
            # "to-read" is the Want to Read shelf
            shelf = row.get("Exclusive Shelf", "")
            if shelf == "to-read":
                books.append({
                    "title": row.get("Title", ""),
                    "author": row.get("Author", ""),
                    "isbn": row.get("ISBN", "").strip('="'),
                    "isbn13": row.get("ISBN13", "").strip('="'),
                })
    return books


def check_books(goodreads_csv: str, output_file: str | None = None):
    """Check availability of Goodreads books at the library."""

    print(f"Loading books from {goodreads_csv}...")
    books = load_goodreads_csv(goodreads_csv)
    print(f"Found {len(books)} books on your 'Want to Read' shelf\n")

    available_books = []
    unavailable_books = []

    for i, book in enumerate(books, 1):
        title = book["title"]
        author = book["author"]
        isbn = book["isbn13"] or book["isbn"]

        print(f"[{i}/{len(books)}] Searching: {title} by {author}...")

        # Search by ISBN first if available, then by title+author
        results = []
        if isbn:
            results = search_library(isbn)

        if not results:
            # Fall back to title + author search
            search_query = f"{title} {author}"
            results = search_library(search_query)

        # Check if any result is available
        found_available = False
        for result in results:
            # Basic title matching (fuzzy)
            title_lower = title.lower()
            result_title_lower = result.title.lower()

            if title_lower in result_title_lower or result_title_lower in title_lower:
                if result.status == "AVAILABLE" and result.available_copies > 0:
                    available_books.append({
                        "goodreads_title": title,
                        "goodreads_author": author,
                        "library_title": result.title,
                        "format": result.format,
                        "available": result.available_copies,
                        "total": result.total_copies,
                        "url": result.catalog_url,
                    })
                    print(f"  ✓ AVAILABLE ({result.available_copies}/{result.total_copies} copies) - {result.format}")
                    found_available = True
                    break
                elif result.total_copies > 0:
                    print(f"  ○ Found but not available ({result.available_copies}/{result.total_copies}) - {result.format}")

        if not found_available:
            unavailable_books.append({"title": title, "author": author})
            if not results:
                print("  ✗ Not found in catalog")

        # Be nice to the API
        time.sleep(0.3)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"\nAvailable now: {len(available_books)}")
    print(f"Not available/found: {len(unavailable_books)}")

    if available_books:
        print("\n📚 AVAILABLE BOOKS:")
        print("-" * 40)
        for book in available_books:
            print(f"  • {book['goodreads_title']}")
            print(f"    by {book['goodreads_author']}")
            print(f"    Format: {book['format']} | Copies: {book['available']}/{book['total']}")
            print(f"    {book['url']}")
            print()

    # Optionally save to file
    if output_file:
        output = {
            "available": available_books,
            "unavailable": unavailable_books,
        }
        with open(output_file, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to {output_file}")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python library_checker.py <goodreads_export.csv> [output.json]")
        print("\nTo export from Goodreads:")
        print("  1. Go to goodreads.com/review/import")
        print("  2. Click 'Export Library'")
        print("  3. Download the CSV file")
        sys.exit(1)

    csv_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    check_books(csv_file, output_file)
