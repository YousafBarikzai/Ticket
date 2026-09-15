/**
 * The CSV reader lives in the platform package now, because migration (MOD-24)
 * reads the same files discovery does and one grammar deserves one parser.
 * Re-exported here so nothing inside this module had to move.
 */
export { parseCsv, parseCsvRecords, type CsvOptions } from '@itsm/platform';
