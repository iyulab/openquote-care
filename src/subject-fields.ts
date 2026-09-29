// The subject fields this app knows: what a heading in a pasted sheet means, and which values a
// session keeps as they were on the day it was recorded.

/** A subject field: its key in the vault and the headings a sheet may give it. */
export interface SubjectField {
  key: string
  headings: string[]
  /**
   * Copied onto a session when it is recorded, so the session keeps the value of that day (a grade
   * changes every school year; a report on last year must not see this year's).
   */
  atSession?: boolean
}

export const SUBJECT_FIELDS: SubjectField[] = [
  { key: 'name', headings: ['이름', '성명', '학생명', '대상자'] },
  { key: 'mgmt_no', headings: ['관리번호', '사례번호'] },
  { key: 'school', headings: ['학교', '학교명'] },
  { key: 'grade', headings: ['학년'], atSession: true },
  { key: 'class', headings: ['반'], atSession: true },
  { key: 'gender', headings: ['성별'] },
  { key: 'phone', headings: ['연락처', '전화', '휴대전화'] },
  { key: 'guardian', headings: ['보호자'] },
  { key: 'guardian_phone', headings: ['보호자 연락처', '보호자연락처'] },
]

/** The field a sheet heading names, or undefined for a heading this app does not keep. */
export function fieldOfHeading(heading: string): SubjectField | undefined {
  const h = heading.replace(/\s+/g, ' ').trim()
  return SUBJECT_FIELDS.find((f) => f.headings.includes(h) || f.key === h)
}

/** How a person reads a field key: its first heading, or the key itself. */
export function headingOf(key: string): string {
  return SUBJECT_FIELDS.find((f) => f.key === key)?.headings[0] ?? key
}

/** The values a new session takes from its subject, as they stand when it is recorded. */
export function atSession(subject: { fields: Record<string, unknown> }): Record<string, string> {
  const values: Record<string, string> = {}
  for (const f of SUBJECT_FIELDS) {
    const v = subject.fields[f.key]
    if (f.atSession && typeof v === 'string' && v !== '') values[f.key] = v
  }
  return values
}
