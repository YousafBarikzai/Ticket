import type { BankHoliday } from '../plan/content-types.js';

/**
 * England and Wales bank holidays, 2026 to 2028 (A4 §1.10.4), as GOV.UK
 * publishes them: when Christmas Day, Boxing Day or New Year's Day falls at a
 * weekend, the holiday moves to the next weekday ("substitute day"), so every
 * date here is a Monday to Friday.
 *
 * The `northwind-uk` calendar closes on these days, so business time — every
 * SLA clock and every "due in 3 business hours" — skips them, and arrivals
 * fall to the holiday rate. The list is a fixed table rather than a rule,
 * because the government moves or adds days by proclamation (2020's VE Day,
 * 2022's and 2023's royal holidays) and a rule would silently miss the next
 * one. `holidays.test.ts` fails once today + 150 days runs past the last date,
 * which forces this table to be extended before the demo's window outruns it.
 */
export const BANK_HOLIDAYS = [
  { date: '2026-01-01', name: 'New Year’s Day' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-04', name: 'Early May bank holiday' },
  { date: '2026-05-25', name: 'Spring bank holiday' },
  { date: '2026-08-31', name: 'Summer bank holiday' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-28', name: 'Boxing Day (substitute day)' },

  { date: '2027-01-01', name: 'New Year’s Day' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-05-03', name: 'Early May bank holiday' },
  { date: '2027-05-31', name: 'Spring bank holiday' },
  { date: '2027-08-30', name: 'Summer bank holiday' },
  { date: '2027-12-27', name: 'Christmas Day (substitute day)' },
  { date: '2027-12-28', name: 'Boxing Day (substitute day)' },

  { date: '2028-01-03', name: 'New Year’s Day (substitute day)' },
  { date: '2028-04-14', name: 'Good Friday' },
  { date: '2028-04-17', name: 'Easter Monday' },
  { date: '2028-05-01', name: 'Early May bank holiday' },
  { date: '2028-05-29', name: 'Spring bank holiday' },
  { date: '2028-08-28', name: 'Summer bank holiday' },
  { date: '2028-12-25', name: 'Christmas Day' },
  { date: '2028-12-26', name: 'Boxing Day' },
] satisfies readonly BankHoliday[];
