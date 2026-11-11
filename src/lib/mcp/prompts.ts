import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'

/**
 * Starter prompts: what a student would type first. Clients list them (Claude
 * under "+", Claude Code as slash commands); /connect shows each `example`.
 */
const Text = (about: string) => z.string().max(200).describe(about)

export const STARTERS = [
  {
    name: 'small_fun_class',
    title: 'Find a small class people enjoy',
    example: 'Find me a 1 or 2 unit class that people actually enjoy.',
    args: { quarter: Text('The quarter, e.g. "Winter 2027".').optional(), interests: Text('Anything you are into, or want to avoid.').optional() },
    text: (a: Record<string, string | undefined>) =>
      `Find me 1 or 2 unit classes${a.quarter ? ` in ${a.quarter}` : ''} that students actually enjoy${a.interests ? `. I'm into: ${a.interests}` : ''}. Keep only ones that fit my saved schedule, best reviewed first, and quote a line from the reviews for each with a link.`,
  },
  {
    name: 'easiest_requirement',
    title: 'Easiest class for a requirement',
    example: "What's the lightest WAY-ER that still fits my Winter schedule?",
    args: { requirement: Text('The requirement, e.g. "WAY-ER" or "WIM".'), quarter: Text('The quarter, e.g. "Winter 2027".').optional() },
    text: (a: Record<string, string | undefined>) =>
      `What are the lightest-workload classes that satisfy ${a.requirement}${a.quarter ? ` in ${a.quarter}` : ''} and fit my saved schedule? Rank by hours per week, show the rating next to each, and link them.`,
  },
  {
    name: 'compare_classes',
    title: 'Pick between two classes',
    example: 'CS 161 or CS 154 next quarter? Compare the workload and what people say.',
    args: { first: Text('A course, e.g. "CS 161".'), second: Text('Another course, e.g. "CS 154".') },
    text: (a: Record<string, string | undefined>) =>
      `${a.first} or ${a.second}? Compare rating, hours per week, who takes them, when they are offered and what students say in reviews. Then tell me which you would take and why.`,
  },
  {
    name: 'can_i_handle_it',
    title: 'Can I handle adding this class?',
    example: 'Is CS 229 a bad idea on top of my Winter schedule? How many hours a week would I be at?',
    args: { course: Text('The course you are thinking of adding, e.g. "CS 229".'), quarter: Text('The quarter, e.g. "Winter 2027".').optional() },
    text: (a: Record<string, string | undefined>) =>
      `I'm thinking of adding ${a.course}${a.quarter ? ` in ${a.quarter}` : ''}. Add up the reported hours per week for what I already have saved that quarter, then with ${a.course} on top. Tell me about any time overlaps and what reviews say about its workload, and be honest about whether it's too much.`,
  },
  {
    name: 'find_open_section',
    title: 'Find a section that fits',
    example: 'Which CHEM 31A sections still have seats and don\'t clash with my classes?',
    args: { course: Text('The course, e.g. "CHEM 31A".'), quarter: Text('The quarter, e.g. "Winter 2027".').optional() },
    text: (a: Record<string, string | undefined>) =>
      `Which sections of ${a.course}${a.quarter ? ` in ${a.quarter}` : ''} still have open seats and don't overlap my saved schedule? List each with its time, seats left and waitlist. Ask me before changing anything.`,
  },
  {
    name: 'fill_my_program_sheet',
    title: 'Fill my program sheet',
    example: "Here's my program sheet. What's the best-reviewed class for each requirement I have left?",
    args: { program_sheet: z.string().max(20_000).describe('Your program sheet or list of remaining requirements, pasted as text.') },
    text: (a: Record<string, string | undefined>) =>
      `Here is my program sheet:\n\n${a.program_sheet}\n\nFor each requirement I still have left, find the best-reviewed class that fills it and fits my saved schedule. Say which quarter each is offered and link it. Ask me before adding anything.`,
  },
] as const

export function registerPrompts(server: McpServer) {
  for (const p of STARTERS) {
    server.registerPrompt(p.name, { title: p.title, description: p.example, argsSchema: z.object(p.args) }, args => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.text(args as Record<string, string | undefined>) } }],
    }))
  }
}
