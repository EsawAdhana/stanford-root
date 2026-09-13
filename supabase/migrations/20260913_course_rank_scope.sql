-- Ratings are now ranked against the course's own department, not all of Stanford.
--
-- Which peer group a percentile used has to travel with the percentile: a department
-- rank and a Stanford-wide rank are different numbers on the same 1-100 scale, so the
-- UI cannot word the line honestly without knowing which one it holds.
--
-- 197 subjects have at least one rated course and 85 of them have ten or fewer, so a
-- department under DEPARTMENT_RANK_MIN (10) rated classes keeps the Stanford-wide rank
-- and stores rank_scope = NULL.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS rank_scope text;

COMMENT ON COLUMN courses.rank_scope IS
  'Subject that courses.quality_pct was ranked within, or NULL when the subject had '
  'fewer than 10 rated classes and the rank fell back to all of Stanford.';

COMMENT ON COLUMN courses.quality_pct IS
  'Percentile rank (1-100) of courses.quality within courses.rank_scope -- that subject '
  'when set, every rated course at Stanford when NULL. 100 = highest rated. Per LISTING, '
  'not per class: a cross-listed class is ranked once in each department it is listed in.';

COMMENT ON COLUMN courses.rating_breakdown IS
  'Per-category {score, n, pct, scope} for quality / learning / organization. Each category '
  'is shrunk toward its OWN Stanford-wide corpus mean by its OWN empirical-Bayes weight, '
  'because response spread and average differ per question, then ranked within `scope` -- '
  'the course''s subject, or all of Stanford when that subject is too small to rank inside.';
