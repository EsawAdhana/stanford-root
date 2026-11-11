import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'

/**
 * Starter prompts: what a student would type first. Clients list them (Claude
 * under "+", Claude Code as slash commands); /connect shows each `example`.
 */
const Text = (about: string) => z.string().max(200).describe(about)

export const STARTERS = [
  {
    name: 'plan_my_quarter',
    title: 'Plan my quarter',
    example: 'Plan my Winter around what I already have saved.',
    args: { quarter: Text('The quarter to plan, e.g. "Winter 2027".').optional() },
    text: (a: Record<string, string | undefined>) =>
      `Look at my saved Stanford Root schedule${a.quarter ? ` for ${a.quarter}` : ''}. Tell me my units, any overlaps and anything I still have to pick, then suggest well-reviewed classes that fit around it. Ask me what I need before adding anything.`,
  },
  {
    name: 'find_a_requirement',
    title: 'Find a class for a requirement',
    example: 'Find a WAY-ER class that only meets Tuesday and Thursday.',
    args: { requirement: Text('The requirement, e.g. "WAY-ER" or "WIM".'), constraints: Text('Days, times, units or anything to avoid.').optional() },
    text: (a: Record<string, string | undefined>) =>
      `Find classes that satisfy ${a.requirement}${a.constraints ? ` and fit this: ${a.constraints}` : ''}. Keep only ones that fit my saved schedule, best reviewed first, with workload and a link to each.`,
  },
  {
    name: 'compare_classes',
    title: 'Compare two classes',
    example: 'Compare CS 161 and CS 154 on workload and reviews.',
    args: { first: Text('A course, e.g. "CS 161".'), second: Text('Another course, e.g. "CS 154".') },
    text: (a: Record<string, string | undefined>) =>
      `Compare ${a.first} and ${a.second}: rating, hours per week, who takes them, when they are offered and what students say in reviews. Then say which you would take and why.`,
  },
  {
    name: 'professor_reviews',
    title: 'What students say about a professor',
    example: 'What do reviews say about Mehran Sahami?',
    args: { name: Text('The instructor, e.g. "Mehran Sahami".') },
    text: (a: Record<string, string | undefined>) =>
      `What do students say about ${a.name}? Summarize their evaluations, quote a few comments, and list what they teach this year with a link to each class.`,
  },
  {
    name: 'fill_my_program_sheet',
    title: 'Fill my program sheet',
    example: "Here's my program sheet. What's the best-reviewed class for each requirement I have left?",
    args: { program_sheet: z.string().max(20_000).describe('Your program sheet or list of remaining requirements, pasted as text.') },
    text: (a: Record<string, string | undefined>) =>
      `Here is my program sheet:\n\n${a.program_sheet}\n\nFor each requirement I still have left, find the best-reviewed class that fills it and fits my saved schedule. Say which quarter each is offered and link it. Ask me before adding anything.`,
  },
  {
    name: 'export_my_calendar',
    title: 'Export my quarter to a calendar',
    example: 'Export my Winter schedule to my calendar.',
    args: { quarter: Text('The quarter to export, e.g. "Winter 2027".').optional() },
    text: (a: Record<string, string | undefined>) =>
      `Export my saved Stanford Root schedule${a.quarter ? ` for ${a.quarter}` : ''} as an .ics file I can add to my calendar, and tell me what was left off.`,
  },
] as const

export function registerPrompts(server: McpServer) {
  for (const p of STARTERS) {
    server.registerPrompt(p.name, { title: p.title, description: p.example, argsSchema: z.object(p.args) }, args => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text(args as Record<string, string | undefined>) } }],
    }))
  }
}
