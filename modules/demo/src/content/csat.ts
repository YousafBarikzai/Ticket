import type { CsatLibrary } from '../plan/content-types.js';

/**
 * Comments left on satisfaction surveys (A4 §1.13.5), 80 in all.
 *
 * About 45 % of responses carry one, picked by tone from the stars given:
 * four or five stars are positive, three neutral, one or two negative.
 * Nothing else about the ticket chooses the comment, so none names a device
 * or a fault: "Took a week for something that should take an hour" fits a
 * monitor and a mailbox alike. `{agent}` is the first name of whoever
 * resolved the ticket, so the comment reads as written to that person. The
 * mix follows real survey comments: short, mostly about speed and being kept
 * informed, and the negative ones about chasing and repeating themselves
 * rather than about the fix.
 */
export const CSAT_VERBATIMS = {
  positive: [
    '{agent} sorted it in ten minutes, brilliant.',
    'Really clear instructions, thank you.',
    'Quick and friendly as always.',
    'Fixed before I’d finished my coffee. Thanks {agent}!',
    '{agent} explained what had gone wrong, which I appreciated.',
    'Great service — I didn’t have to chase once.',
    'Sorted first time. Thank you.',
    'Very patient with me, thanks {agent}.',
    'Brilliant, back up and running.',
    'Kept me updated the whole way through.',
    'Much quicker than I expected.',
    '{agent} rang me straight back and fixed it while I was on the phone.',
    'Thanks for coming down to the floor to look at it.',
    'Spot on, thank you.',
    'Easy to raise and sorted the same day.',
    'Really helpful — {agent} even showed me how to do it myself next time.',
    'Couldn’t ask for better.',
    'Thank you for fitting this in on a busy day.',
    'Five stars for {agent}.',
    'All working now, many thanks.',
    'Nice to deal with someone who knows their stuff.',
    'The article {agent} sent me fixed it straight away.',
    'Very efficient, thanks.',
    'Thanks for sorting it while I was out at a customer.',
    'Great communication throughout.',
    '{agent} was really helpful and polite.',
    'Fixed remotely without me having to do anything. Perfect.',
    'Good job, thanks for the quick turnaround.',
    'Appreciate the quick help, thank you.',
    'Prompt and professional.',
    'Thanks {agent}, that’s made my week a lot easier.',
    'Sorted out quickly and explained clearly.',
    'Really impressed with how fast this was picked up.',
    'Everything was ready when I got in this morning. Thank you.',
    'Thanks for checking back the next day to make sure it was still working.',
    'Very good service from the whole team.',
    '{agent} went above and beyond.',
    'No fuss, just fixed.',
    'Lovely to get a real answer rather than a script.',
    'Excellent, thank you.',
    'Quick response even though it was late in the day.',
    'Helpful as ever.',
    'Thanks for keeping me in the loop.',
    'Great that I could follow it all in the portal.',
  ],
  neutral: [
    'Fixed in the end, but it took a couple of days.',
    'Fine, though I had to chase once.',
    'Got there eventually.',
    'Works now, not sure what was done.',
    'OK, but it would have helped to know it was waiting on the supplier.',
    'Sorted, though the first suggestion didn’t work.',
    'Took a while to get picked up but {agent} was helpful once it was.',
    'Fine.',
    'Resolved, but it’s happened before so I hope it stays fixed.',
    'Reasonable, though it took most of the day.',
    'Would have been quicker to call, I think.',
    'All good in the end.',
    'The workaround is fine for now, but I’d like a proper fix.',
    'It works, although I had to restart a few times.',
    'Service was OK. Updates could have been more regular.',
    'Fixed, but the ticket was closed before I could check.',
    'Acceptable. A bit slow over the weekend.',
    'Not bad, it just took longer than I hoped.',
  ],
  negative: [
    'Had to explain the problem three times.',
    'Took far too long during month-end.',
    'Still not sure what was wrong.',
    'Nobody updated me for two days.',
    'It’s happened again since — not really fixed.',
    'Had to chase three times before anyone looked at it.',
    'Closed without anyone checking with me.',
    'I was passed between teams and had to repeat everything.',
    'Took a week for something that should take an hour.',
    'The suggested fix didn’t work and I had to call in.',
    'Slow, and I lost half a day of work.',
    'Felt like nobody owned it.',
    'Too long for something so simple.',
    'I was told it would be done the same day. It wasn’t.',
    'The article didn’t match what I was seeing.',
    'Had to find the workaround myself in the end.',
    'Not happy — we were stuck for most of the shift.',
    'Please let people know when something is waiting on a supplier.',
  ],
} satisfies CsatLibrary;
