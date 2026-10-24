# Requirement overlays

One file per program, `<CODE>.json`, correcting what the Bulletin's Coursedog
data gets wrong or leaves as prose. `scripts/build-requirements.mjs` applies
them on every build and fails if one names a rule that no longer exists.

The Bulletin text is the only source. Every change quotes the sentence it
encodes in `why`. If the text does not say it, the overlay does not do it.

## Workflow

```
node scripts/check-requirements.mjs ENGL-BA --tree      # rules, ids, full text
node scripts/check-requirements.mjs --find "PHIL 80"    # look up a course (or --find ENGLISH)
node scripts/check-requirements.mjs ENGL-BA             # every audit scenario; "no findings" is the goal
node scripts/check-requirements.mjs ENGL-BA --explain   # a complete record and where each course went
node scripts/check-requirements.mjs ENGL-BA --record r.json  # audit a record you write (format in check.ts)
node scripts/bulletin-page.mjs ENGL-BA                  # the live Bulletin page as it reads, course codes filled in
```

A program is reviewed when its file has `reviewed` set, every free-text rule
is either encoded, marked `info`, or marked `manual` with a reason, and the
checker reports no findings (or `summary` explains each one left).

## Format

```json
{
  "code": "ENGL-BA",
  "reviewed": "2026-10-23",
  "summary": "One or two sentences: what changed and why, for someone who was not here.",
  "program": { "letterGrade": true, "minGrade": "C-" },
  "blocks": { "<blockId>": { "kind": "subplan|optional|info|required", "units": 40, "shares": true, "unlessSubplan": true } },
  "nodes": {
    "<ruleId>": { "why": "quote", "replace": { ...rule } },
    "<ruleId>": { "why": "quote", "patch": { "n": 3, "manual": "approval" } },
    "<ruleId>": { "why": "quote", "remove": true }
  },
  "alternatives": [ { "id": "ov-...", "name": "Prose or poetry concentration", "of": ["<ruleId>", "<ruleId>"], "n": 1, "why": "quote" } ],
  "add": [ { "block": "<blockId>", "parent": "<ruleId, optional>", "node": { "id": "ov-...", ...rule }, "why": "quote" } ]
}
```

`blocks` entries and `program` take a `why` too, quoting the text behind them.

Ids are the `[...]` and `block ...` ids `--tree` prints. They are the
Bulletin's own and do not change between builds.

### Rules

| `t` | Meaning | Fields |
|---|---|---|
| `courses` | Courses from a list or pool | `mode`, `items`, `pool`, `n`, `units`, `minUnitsEach`, `letter`, `minGrade`, `limits` |
| `all` | Every child | `children` |
| `any` | One child (alternate paths) | `children` |
| `some` | `n` of the children ("three of the four areas") | `n`, `children` |
| `text` | Only a person can check it | `manual`, optional `n`/`units` when courses are moved in |

`mode` for `courses`: `all` (each item), `atLeast` (`n` items), `units`
(`units` units), `any` (a pool: `n` courses or `units` units, else one course).

- `items`: `[["CS 107", "CS 107E"], ["CS 111"]]`, each inner list one slot
  any of whose listings fills it. Codes as `--find` prints them.
- `pool`: `{ "subjects": ["ENGLISH"], "minNumber": 100, "maxNumber": 299,
  "exclude": ["ENGLISH 199"], "excludeGraduate": true }`, or
  `{ "anySubject": true, "excludeSubjects": ["ENGLISH"] }` for "outside the
  department". Numbers compare the digits: ENGLISH 160A is 160. "Upper
  division" is 100 and above.
- `limits`: `[{ "label": "creative writing workshops", "max": 1, "codes": [...] }]`
  or `{ "maxUnits": 10, "pool": {...} }`: caps on what counts inside the rule.
- `manual`: `approval` (advisor or department sign-off, a list on a website),
  `milestone` (qualifying exam, advancement, teaching), `exam`, `thesis`,
  `gpa`, `residency`, `other`. Give `n` or `units` when the student satisfies
  it by moving courses in ("15 units pre-approved by the director").
- `info: true`: not a requirement at all (an overview, advice, a note).
- `shares: true`: a designation whose course also counts elsewhere in the
  program (WIM and capstone sections do by default; a rule that restates
  courses required elsewhere needs it).

`program.letterGrade` / `minGrade` only when the text says every course in
the program must be letter graded or meet the grade.

### Program policies

`--tree` prints, above the blocks, the program fields the Bulletin keeps
outside its rules: `unitsMin` (Minimum Units in the Program),
`subplanRequired`, `GPA`, `Grading`, `Policies`, `Transfer and AP credit`
and `Other requirements`. They are requirements as much as the rules are:

- Grading that covers every course ("Courses counting toward the major must
  be taken for a letter grade, ... C or better"): `program.letterGrade`,
  `program.minGrade`. Grading for some courses only: `letter`, `minGrade` or
  `minUnitsEach` on those rules. A sanctioned exception ("two electives may
  be CR/NC with the DUS's approval") stays a move by hand.
- "Courses can only be counted once / satisfy one requirement": the WIM and
  capstone blocks get `"shares": false`, and so does any rule with `shares`.
- A GPA the audit cannot compute: a `text` rule with `manual: "gpa"`.
- Other requirements that are real requirements ("submit a senior survey",
  "field experience"): a `text` rule with `manual`. A bare "dept. approval"
  is not one.
- Caps and minimums across the program: `program.totals` (below).
- `subplanRequired: false`: a student may finish without a subplan, and the
  subplan picker offers "No subplan". A block that only applies without one
  ("complete the Literature depth, or one subplan") gets `"unlessSubplan": true`
  in `blocks`. Override the flag with `program.subplanRequired` only when the
  text says otherwise, and quote it.
- `unitsMin` comes from the Bulletin now; set `program.unitsMin` only when
  the text gives another number, and quote it. For a PhD, the 135 units the
  university requires is the right check when the text states it.

### Counts over the whole program

`program.unitsMin` is the Bulletin's "Minimum Units in the Program", and the
audit checks it. For a graduate program (master's, PhD, Engineer) it counts
every graduate-career course on the record, research units included,
leaving out courses the program's `letterGrade`/`minGrade` rejects. For
anything else it counts the courses applied to the program's rules.

`program.totals` holds the other counts that span rules:

```json
"program": {
  "unitsMin": 45,
  "totals": [
    { "label": "23 units at the 200 level", "minUnits": 23, "pool": { "anySubject": true, "minNumber": 200 }, "why": "quote" },
    { "label": "27 units in Education", "minUnits": 27, "pool": { "subjects": ["EDUC"] }, "why": "quote" },
    { "label": "13 courses", "minCourses": 13, "why": "quote" },
    { "label": "Letter-graded units", "minUnits": 36, "grading": "letter", "why": "quote" },
    { "label": "CR/NC units", "maxUnits": 10, "grading": "not-letter", "why": "quote" },
    { "label": "Language courses", "maxUnits": 30, "pool": { "subjects": ["CHINLANG", "JAPANLNG"] }, "why": "quote" },
    { "label": "EARTHSYS 323", "maxUnits": 16, "codes": ["EARTHSYS 323"], "why": "quote" },
    { "label": "66 units with the Philosophy subplan", "minUnits": 66, "when": "<subplan block id>", "why": "quote" }
  ]
}
```

- `minUnits` / `minCourses`: a requirement. `pool`, `codes` and `grading`
  narrow which courses count toward it; none means all of them.
- `maxUnits` alone is a cap: units past it stop counting toward the
  program's other totals and `unitsMin` ("no more than 30 units of language
  courses may be counted toward the major"). Taking more is not a failure.
  "All units must be at the 100 level or above" is a cap of 0 on a pool with
  `maxNumber: 99`.
- `maxCourses` caps a number of courses ("count 2 classes S/NC"): past it,
  a course counts for nothing. It binds the rules like `maxUnits` does.
- A cap on CR/NC units (`grading: "not-letter"`) always binds the rules:
  past it, the courses fill nothing ("up to 10 units CR/NC; the remainder
  must be taken for a letter grade").
- `inRules: true` on a cap makes it bind the rules too: past it, those units
  count toward no requirement ("no more than 5 units of directed reading may
  count toward the major", where a track floor must not count the sixth). Leave
  it off when the rules themselves ask for the courses ("at most 2 honors units
  toward the 62", while the honors rule needs all 10).
- `minUnits` with `maxUnits` is a range ("21-35 units"), which going over breaks.
- `when`: only while that subplan or optional section is in the plan;
  `unless`: only while it is not ("honors students are exempt").
- A cap's `pool` weighs the listing the student took: CSRE 145 is not a
  DAAAS course for "up to 15 units of DAAAS courses", though it is also
  AFRICAAM 145. (`anySubject` pools still see every listing, so a course
  cross-listed in the department is never "outside" it.)

"The remaining units of the 60-unit minimum, in X": set `unitsMin` and add
an optional pool rule for X. It takes the extra courses, asks for no count of
its own, and the program total does the checking:

```json
{ "id": "ov-remaining", "t": "courses", "mode": "any", "pool": { "subjects": ["LINGUIST"] }, "optional": true, "name": "Remaining units in Linguistics" }
```

Courses from elsewhere that need approval go in a sibling `text` rule with
`manual: "approval"` and `optional: true`; the student moves them in.

### Repeated courses

Three ways, all counted as separate enrollments by the audit: list the same
course in several items (`[["EBS 300"], ["EBS 300"]]`), ask for `n` of a
one-item rule (`"mode": "atLeast", "n": 9, "items": [["OB 678"]]`), or ask
for units of one course (`"mode": "units", "units": 12, "items": [["TRAM 299P"]]`).

### Other fields

- `pool.onlyGraduate: true`: graduate-career listings only ("graduate-level
  courses"); `pool.excludeGraduate` is the reverse.
- `pool.takenListing: true`: the listing the student took must be in the
  pool, a cross-listing does not do ("must have the HISTORY subject code").
- `optional: true` on a group (`all`, `any`, `some`) makes the whole group
  optional; `info: true` makes it information.
- A `shares` rule that asks for units or several courses takes as many as it
  needs, preferring courses the program already counts.
- A course a student moves into a designation (a `shares` rule or a WIM
  block) still counts for the rule it fills; moving it there does not take
  it out.

## What to look for

1. Free text that names courses, subjects, numbers, unit totals or counts:
   encode it.
2. Alternatives entered as all-required: "either the prose or poetry
   concentration", "Option 1 / Option 2", "Path A or Path B". Wrap them with
   `alternatives`. Parts of one requirement ("Track A Requirement",
   "Track B Requirement" in CS) are not alternatives.
3. Counts that disagree with the text: `n`, a list that should be "one of"
   (`atLeast` 1) rather than all, a unit floor read from a name.
4. A section that is a subplan, optional (honors, distinction) or only
   information, but is not marked so.
5. Findings from the checker: "listed courses run out" means the rule asks
   for more than it lists; fix the rule if the text explains how.
