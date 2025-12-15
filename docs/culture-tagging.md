# Culture Tagging Prompt Guide

## Core Concept

Culture tags capture the **era + tradition** the author belongs to - their intellectual lineage and worldview, not the book's topic.

The key question: **What tribe was the author part of? What assumptions did they share with their peers?**

## Categories

```
medieval-christian     - Eckhart, Teresa of Ávila, pre-Reformation mystics
sufi                   - Rumi, Hafez, Islamic mysticism
eastern-classical      - Pre-1900 Hindu, Buddhist, Taoist masters
20th-century-jewish    - Buber, Heschel, Arendt - existentialist/dialogical Jewish thinkers
victorian-esoteric     - Gurdjieff, Theosophy-adjacent, early 1900s occult
mid-century-christian  - C.S. Lewis, Chesterton, Inklings (1920s-1960s)
psychoanalytic         - Freud, Jung, early depth psychology (pre-1970)
austrian-economics     - Hayek, Mises, Paterson, Rand's circle
60s-consciousness      - Esalen, human potential, counterculture, NVC, unschooling
80s-self-help          - Covey, Robbins, Tolle, pop psychology/spirituality
therapy-culture        - Attachment, IFS, trauma-informed, polyvagal (2000s+)
silicon-valley         - Founders, VCs, startup culture, business books
bro-optimization       - Ferriss, Huberman, biohacking, fitness
tantric-embodiment     - Deida, Michaela Boehm, sacred sexuality, polarity
literary-contemporary  - MFA culture, New Yorker, contemporary fiction/memoir
21st-century-conservative - Post-liberal, traditionalist, anti-modern (Crawford, Han)
ccp-intellectual       - Chinese Communist Party theorists
academic-contemporary  - Current professors, peer-reviewed, neutral scholarly
pop-science            - Accessible science writing for general audience
20th-century-catholic  - Edith Stein, Girard, Flannery O'Connor, Catholic intellectuals
```

## Prompt Template

```
Classify these books by the ERA + TRADITION the AUTHOR belongs to.
This is about the author's worldview and intellectual lineage, not the book's topic.

Key questions:
- What decade/era was the author intellectually formed?
- Who were their peers and influences?
- What assumptions did they share with their tribe?
- What podcast today would promote this author?

Use the PUBLISH YEAR as a strong signal:
- Pre-1900: likely classical tradition (medieval-christian, sufi, eastern-classical)
- 1900-1950: early 20th century movements (20th-century-jewish, psychoanalytic, austrian-economics)
- 1950-1970: mid-century (mid-century-christian, early psychoanalytic)
- 1965-1985: counterculture era (60s-consciousness)
- 1980-2000: self-help boom (80s-self-help)
- 2000+: contemporary (therapy-culture, silicon-valley, bro-optimization, 21st-century-conservative)

Categories (use exactly these strings):
[list categories]

For authors you don't recognize, search for "[author name] author bio" to understand their background.

Books to classify:
1. [book_id] | [title] | [author] | [publish_year]
...

Return ONLY a JSON array: [{"book_id": "123", "culture": "therapy-culture"}, ...]
```

## Key Distinctions

### Topic vs Culture
- A 2020 book about Jung by a therapy-culture author → `therapy-culture`
- Jung's own writings → `psychoanalytic`
- Same topic, different tribes

### Era Matters
- Eckhart Tolle feels spiritual but he's really `80s-self-help` era (Oprah, mass market)
- Joseph Campbell feels 60s but he's really `psychoanalytic` (Jungian lineage)
- Yogananda is `eastern-classical` even though Americans read him in the 60s

### When to Use Web Search
Search for author bio when:
- Author is not famous/recognizable
- You're unsure of their intellectual background
- The book title doesn't clearly signal the tradition

Wikipedia API: `https://en.wikipedia.org/api/rest_v1/page/summary/[Author_Name]`

### Common Mistakes
- Tagging by topic instead of author's tribe
- Putting all spiritual books in one bucket (distinguish 60s-consciousness vs 80s-self-help vs eastern-classical)
- Missing the political valence of "neutral" academics (some are conservative, some are progressive)
- Confusing contemporary Christians with mid-century-christian (Lewis era was specific)

## Examples

| Book | Wrong | Right | Why |
|------|-------|-------|-----|
| A New Earth (Tolle) | 60s-consciousness | 80s-self-help | Tolle is 2000s Oprah spirituality, not Esalen |
| Shop Class as Soulcraft | academic-contemporary | 21st-century-conservative | Crawford is explicitly anti-modern, post-liberal |
| The Power of Myth (Campbell) | 60s-consciousness | psychoanalytic | Campbell was Jung's lineage, not counterculture |
| NVC (Rosenberg) | therapy-culture | 60s-consciousness | Rosenberg was humanistic psychology era, not trauma-informed |
| Wang Huning | conservative | ccp-intellectual | He's CCP Politburo, completely different tradition |
