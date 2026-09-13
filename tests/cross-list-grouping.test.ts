import { describe, it, expect } from 'vitest'
import { deriveEvalPairings, getCrossListGroupIds, buildCrossListGroups, normalizeCourseId, crossListedSectionPeers } from '@/lib/utils'
import type { Course, Section } from '@/types/course'

const catalog = (...ids: string[]) => new Set(ids.map(normalizeCourseId))

describe('deriveEvalPairings', () => {
  it('pairs the codes one evaluation report covers', () => {
    const pairs = deriveEvalPairings(
      [{ course_code: 'Sp24-MATSCI-184-01/Sp24-MATSCI-214-01' }],
      catalog('MATSCI184', 'MATSCI214'),
    )
    expect(pairs.get('MATSCI184')).toEqual(['MATSCI214'])
    expect(pairs.get('MATSCI214')).toEqual(['MATSCI184'])
  })

  it('ignores codes that are not in the catalog', () => {
    const pairs = deriveEvalPairings(
      [{ course_code: 'F25-CSRE-10-01/F25-GHOST-99-01' }],
      catalog('CSRE10'),
    )
    expect(pairs.size).toBe(0)
  })

  it('emits nothing for a single-code report', () => {
    expect(deriveEvalPairings([{ course_code: 'F25-CS-106A-01' }], catalog('CS106A')).size).toBe(0)
  })

  // --- inputs built to break it ---
  it('strips every term prefix Stanford uses, including the Law forms', () => {
    for (const code of ['Sp24-EE-267-01/Sp24-EE-267W-01', 'SP18-EE-267-01/SP18-EE-267W-01',
      'S21-EE-267-01/S21-EE-267W-01', 'W26-EE-267-01/W26-EE-267W-01']) {
      const pairs = deriveEvalPairings([{ course_code: code }], catalog('EE267', 'EE267W'))
      expect(pairs.get('EE267'), code).toEqual(['EE267W'])
    }
  })

  it('never pairs a code with itself when two of its sections share a report', () => {
    const pairs = deriveEvalPairings(
      [{ course_code: 'Sp24-MATH-51-01/Sp24-MATH-51-02' }],
      catalog('MATH51'),
    )
    expect(pairs.get('MATH51')).toBeUndefined()
  })

  it('tolerates missing, empty and malformed course_code', () => {
    const pairs = deriveEvalPairings(
      [{}, { course_code: null }, { course_code: '' }, { course_code: '///' }, null as never],
      catalog('CS106A'),
    )
    expect(pairs.size).toBe(0)
  })

  it('accumulates across reports and returns each list sorted and unique', () => {
    const pairs = deriveEvalPairings([
      { course_code: 'F24-A-1-01/F24-B-2-01' },
      { course_code: 'F25-A-1-01/F25-B-2-01' },
      { course_code: 'F25-A-1-01/F25-C-3-01' },
    ], catalog('A1', 'B2', 'C3'))
    expect(pairs.get('A1')).toEqual(['B2', 'C3'])
  })
})

describe('grouping with evaluation pairings', () => {
  const courses = [
    { id: 'MATSCI184', title: 'Electronic Materials' },
    { id: 'MATSCI214', title: 'Electronic Materials' },
    { id: 'CS106A', title: 'Programming Methodology' },
  ]

  it('groups codes the catalog never declared cross-listed', () => {
    const withPairs = courses.map(c => ({
      ...c,
      crossListWith: c.id === 'MATSCI184' ? ['MATSCI214'] : c.id === 'MATSCI214' ? ['MATSCI184'] : [],
    }))
    expect(getCrossListGroupIds('MATSCI184', withPairs).sort()).toEqual(['MATSCI184', 'MATSCI214'])
    expect(getCrossListGroupIds('CS106A', withPairs)).toEqual(['CS106A'])
  })

  it('leaves them separate when no pairing is supplied', () => {
    // Same titles, no declared siblings -- so the pairing really is what merges them.
    expect(getCrossListGroupIds('MATSCI184', courses)).toEqual(['MATSCI184'])
  })

  it('still honours a title-declared sibling', () => {
    const titled = [
      { id: 'CS24', title: 'Minds and Machines (LINGUIST 35)', crossListWith: [] },
      { id: 'LINGUIST35', title: 'Minds and Machines (CS 24)', crossListWith: [] },
    ]
    expect(getCrossListGroupIds('CS24', titled).sort()).toEqual(['CS24', 'LINGUIST35'])
  })

  it('does not chain unrelated classes into one blob through a shared code', () => {
    // A-B share a report and B-C share a different one, so all three are one class;
    // D must stay out of it.
    const rows = [
      { id: 'A1', title: 'x', crossListWith: ['B2'] },
      { id: 'B2', title: 'x', crossListWith: ['A1', 'C3'] },
      { id: 'C3', title: 'x', crossListWith: ['B2'] },
      { id: 'D4', title: 'x', crossListWith: [] },
    ]
    const groups = buildCrossListGroups(rows)
    const sizes = [...groups.values()].map(g => g.length).sort()
    expect(sizes).toEqual([1, 3])
    expect(getCrossListGroupIds('D4', rows)).toEqual(['D4'])
  })

  it('is order-independent: the same group whichever member you enter from', () => {
    const rows = [
      { id: 'A1', title: 'x', crossListWith: ['B2'] },
      { id: 'B2', title: 'x', crossListWith: ['A1', 'C3'] },
      { id: 'C3', title: 'x', crossListWith: ['B2'] },
    ]
    const a = getCrossListGroupIds('A1', rows).sort()
    expect(getCrossListGroupIds('B2', rows).sort()).toEqual(a)
    expect(getCrossListGroupIds('C3', rows).sort()).toEqual(a)
  })

  it('ignores a pairing that points outside the catalog', () => {
    const rows = [{ id: 'A1', title: 'x', crossListWith: ['NOTINCATALOG9'] }]
    expect(getCrossListGroupIds('A1', rows)).toEqual(['A1'])
  })
})

describe('crossListedSectionPeers — the class number under each other listing', () => {
    const sec = (over: Partial<Section>): Section => ({
        term: 'Winter 2027', classId: 0, sectionNumber: '1', component: 'LEC',
        status: 'Open', units: '4-5', grading: '', instructionalMode: 'In Person',
        enrolled: 0, capacity: 0, openSeats: 0, waitlist: 0, waitlistMax: 0,
        startDate: '', endDate: '', meetings: [],
        ...over,
    } as unknown as Section)

    const anchor = sec({ classId: 12292 })
    const sibling = sec({ classId: 12515 })
    const courses = [
        { id: 'COMM172', subject: 'COMM', code: '172', title: 'Media Psychology (COMM 272)', sections: [anchor] },
        { id: 'COMM272', subject: 'COMM', code: '272', title: 'Media Psychology (COMM 172)', sections: [sibling] },
    ] as unknown as Course[]

    it('reports the sibling listing and its own class number', () => {
        expect(crossListedSectionPeers(anchor, 'COMM172', ['COMM172', 'COMM272'], courses))
            .toEqual([{ courseId: 'COMM272', subject: 'COMM', code: '272', classId: 12515 }])
    })

    it('says nothing for a class with one listing', () => {
        expect(crossListedSectionPeers(anchor, 'COMM172', ['COMM172'], courses)).toEqual([])
    })

    it('does not repeat a shared class number', () => {
        const shared = [
            { id: 'A1', subject: 'A', code: '1', title: 'X (B 1)', sections: [anchor] },
            { id: 'B1', subject: 'B', code: '1', title: 'X (A 1)', sections: [anchor] },
        ] as unknown as Course[]
        expect(crossListedSectionPeers(anchor, 'A1', ['A1', 'B1'], shared)).toEqual([])
    })

    it('ignores a sibling section from another term', () => {
        const springSibling = sec({ classId: 999, term: 'Spring 2027' })
        const other = [
            courses[0],
            { id: 'COMM272', subject: 'COMM', code: '272', title: 'Media Psychology (COMM 172)', sections: [springSibling] },
        ] as unknown as Course[]
        expect(crossListedSectionPeers(anchor, 'COMM172', ['COMM172', 'COMM272'], other)).toEqual([])
    })
})
