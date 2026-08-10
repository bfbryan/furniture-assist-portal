// lib/airtable/schedule.ts
//
// Reads against the Saturday Schedule table (appointment capacity per date).

import { airtableFetch } from './client'

export async function getSaturdaySchedule() {
  const data = await airtableFetch('Saturday Schedule', '?sort[0][field]=Date&sort[0][direction]=asc')

  return data.records.map((record: any) => ({
    id: record.id,
    date: record.fields['Date'] as string,
    status: (record.fields['Status'] as string) ?? 'Open',
    slots9am: (record.fields['9am'] as number) ?? 0,
    slots10am: (record.fields['10am'] as number) ?? 0,
    slots11am: (record.fields['11am'] as number) ?? 0,
    slots12pm: (record.fields['12pm'] as number) ?? 0,
    slots1pm: (record.fields['1pm'] as number) ?? 0,
    totalFilled: (record.fields['Total Slots Filled'] as number) ?? 0,
    totalCapacity: (record.fields['Total Capacity'] as number) ?? 50,
    slotsRemaining: (record.fields['Slots Remaining'] as number) ?? 0,
    mailMergeComplete: (record.fields['Mail Merge Complete'] as boolean) ?? false,
  }))
}
